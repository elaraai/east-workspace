/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The Flowchart's drops (#1501, `Flowchart Records Spec.md` R14, D5, D8) —
 * pure and React-free: what a library card does where it lands, decided as
 * data before anything is drawn or written. The frame records a plan as one
 * step of the editing's history (`use-drop.ts`), and the canvas works out
 * where a drag rests from its own drawing.
 *
 * - **What is dragged** ({@link FlowchartDropCard}, {@link dropHostOf}): a
 *   card of a tab that drops — a state's card, which adds a state where it
 *   lands on a lane; a transition's card, which gives a transition its values;
 *   a lane's card, which adds a lane where it lands on the band row; an
 *   author's card, whose patch sets its fields on a row of the kind it names.
 * - **Where a drag rests** ({@link FlowchartDropAtType}, {@link dropAtPoint}):
 *   what lies under the pointer of what the card lands on — a lane, and the
 *   row a new state takes in it; a state; a transition, near its line; a
 *   lane's header; the gap between two lanes, or the band row's tail; a
 *   decision's diamond — or the canvas, where nothing it lands on lies. A row
 *   the narrowing draws as context, and the band *No lane*, take no card. The
 *   shared drag grammar's `CellRef` carries it in its `row`, printed.
 * - **What a drop does** ({@link planDrop}, {@link dropEdits}): a state from
 *   the card's values in the lane it lands in, keyed `state-<n>`, its order
 *   between the cards it lands between; a transition given the card's values,
 *   its ends and its key kept; a lane from the card's values where it lands,
 *   keyed `lane-<n>`, its order between the lanes'; an author's card's fields
 *   set — or refused, with the reason the ghost says in red: anywhere but what
 *   the card lands on, a kind read only (R13), or a kind taking no edit now.
 * - **⏎ on a card** ({@link enterAt}): a drop on the canvas's selection — a
 *   state's card after the selected state, at the end of the selected lane, or
 *   at the end of the first lane; a lane's card after the selected lane, or at
 *   the band row's tail; any other card on what is selected, when that is what
 *   it lands on.
 * - **Its words** ({@link dropCaption}, {@link dropName}, {@link dropRefusal},
 *   {@link dropLabel}) and **its marks** ({@link markOf}): the lane it lands
 *   in and the row, the gap a lane lands in, or what it sets its fields on.
 *
 * @packageDocumentation
 */

import { IntegerType, NullType, StringType, StructType, VariantType, equalFor, parseFor, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { getSomeorUndefined, type DragPayload, type DropCellOptions, type DropVeto } from "@elaraai/east-ui-components";
import { dropTargetAt, laneAt } from "./connect.js";
import type { FlowchartFieldWrites } from "./editing.js";
import { dropLane, dropState, dropTransition, setFields, type FlowchartHolding, type GestureEdits } from "./edits.js";
import { NODE_H, NODE_W, type FlowchartLayout, type Pt, type RouteSeg } from "./layout.js";
import type { FlowchartDropPlaceWord, FlowchartDropRefusalWord, FlowchartDropWhatWord, FlowchartLandsWord, FlowchartMessages } from "./messages.js";
import type { FlowchartModel, FlowchartValue, ModelNode } from "./model.js";
import type { FlowchartSort } from "./read.js";
import { drawsTransition, type FlowchartSelection } from "./selection.js";

const keyEqual = equalFor(StringType);

// ── What is dragged ───────────────────────────────────────────────────────

/** What a library card lands on. */
export type FlowchartLands = FlowchartLandsWord;

/** A card the canvas takes, as the Flowchart reads it: what its drop does, and its name. */
export type FlowchartDropCard =
    /** A state's card: a new state where it lands on a lane, every field but its lane and its order the card's values. */
    | { readonly does: "addState"; readonly label: string; readonly values: Uint8Array }
    /** A transition's card: its values given to the transition it lands on, its ends and its key kept. */
    | { readonly does: "retype"; readonly label: string; readonly values: Uint8Array }
    /** A lane's card: a new lane where it lands on the band row, every field but its order the card's values. */
    | { readonly does: "addLane"; readonly label: string; readonly values: Uint8Array }
    /** An author's card: the fields its patch sets, on a row of the kind its patch names. */
    | { readonly does: "set"; readonly sort: FlowchartSort; readonly label: string; readonly sets: FlowchartFieldWrites };

/**
 * The kind a card writes.
 *
 * @param card - The card
 * @returns The kind
 */
export function cardSort(card: FlowchartDropCard): FlowchartSort {
    switch (card.does) {
        case "addState": return "states";
        case "retype": return "transitions";
        case "addLane": return "lanes";
        case "set": return card.sort;
    }
}

/** What an author's card lands on, by the kind its patch names. */
const SET_LANDS: { readonly [S in FlowchartSort]: FlowchartLands } = {
    states: "state", transitions: "transition", lanes: "header", decisions: "decision",
};

/**
 * What a card lands on.
 *
 * @param card - The card
 * @returns What it lands on
 */
export function landsOf(card: FlowchartDropCard): FlowchartLands {
    switch (card.does) {
        case "addState": return "lane";
        case "retype": return "transition";
        case "addLane": return "gap";
        case "set": return SET_LANDS[card.sort];
    }
}

/** What the canvas takes dropped: its drop target, and each library whose cards drop — its cards by key. */
export interface FlowchartDropHost {
    /** The Flowchart's drop target: the surface its canvas registers on. */
    readonly surface: string;
    /** Each library whose cards drop, by its id: its cards, by key. */
    readonly libraries: ReadonlyMap<string, ReadonlyMap<string, FlowchartDropCard>>;
}

/** A kind's cards, as the wire carries them. */
type Templates = FlowchartValue["states"]["templates"];

/** A kind's cards by key, each read as a card that drops. */
function cardsOf(templates: Templates, does: "addState" | "retype" | "addLane"): ReadonlyMap<string, FlowchartDropCard> {
    return new Map(templates.map((template) => [template.key, { does, label: template.name, values: template.values }] as const));
}

/** The kinds that carry cards, as the drops read them. */
export interface FlowchartCardKinds {
    /** The states' cards. */
    readonly states: Templates;
    /** The transitions' cards; none for a Flowchart given no transitions. */
    readonly transitions: Templates;
    /** The lanes' cards; none for a Flowchart given no lanes. */
    readonly lanes: Templates;
}

/**
 * What the canvas takes dropped, from the tabs the payload lists: the Steps
 * tab's cards, each adding a state; the Transitions tab's, each giving a
 * transition its values; the Lanes tab's, each adding a lane; and each
 * author's tab whose patch names a kind, its cards by their keys. An author's
 * tab with no `drop` drops nothing.
 *
 * @param surface - The Flowchart's drop target
 * @param libraryOf - The library a tab's cards drag from, by the tab's key
 * @param tabs - The tabs the payload lists
 * @param kinds - The kinds' cards
 * @returns What the canvas takes
 */
export function dropHostOf(surface: string, libraryOf: (tabKey: string) => string, tabs: FlowchartValue["library"], kinds: FlowchartCardKinds): FlowchartDropHost {
    const libraries = new Map<string, ReadonlyMap<string, FlowchartDropCard>>();
    for (const tab of tabs) {
        switch (tab.type) {
            case "states": libraries.set(libraryOf("states"), cardsOf(kinds.states, "addState")); break;
            case "transitions": libraries.set(libraryOf("transitions"), cardsOf(kinds.transitions, "retype")); break;
            case "lanes": libraries.set(libraryOf("lanes"), cardsOf(kinds.lanes, "addLane")); break;
            case "tab": {
                const sort = getSomeorUndefined(tab.value.drop) as FlowchartSort | undefined;
                if (sort === undefined) break;
                libraries.set(libraryOf(`tab:${tab.value.name}`),
                    new Map(tab.value.cards.map((card) => [card.key, { does: "set", sort, label: card.label, sets: card.sets }] as const)));
                break;
            }
        }
    }
    return { surface, libraries };
}

/**
 * A card the canvas takes, by its library and its key.
 *
 * @param host - What the canvas takes
 * @param library - The card's library
 * @param key - The card's key
 * @returns The card, or `undefined` for one no tab that drops lists
 */
export function cardOf(host: FlowchartDropHost, library: string, key: string): FlowchartDropCard | undefined {
    return host.libraries.get(library)?.get(key);
}

// ── Where a drag rests ────────────────────────────────────────────────────

/** Where a drag rests over the canvas, for what it carries — what a Flowchart's drop `CellRef` names in its `row`, printed. */
export const FlowchartDropAtType = VariantType({
    /** A band, by its key, and the row a new state takes in it: after the states above the pointer. */
    lane: StructType({ lane: StringType, row: IntegerType }),
    /** A state, by its key. */
    state: StringType,
    /** A transition, by its key. */
    transition: StringType,
    /** A lane's header, by the lane's key. */
    header: StringType,
    /** Where a new lane lands among the lanes: 0 before the first, their count at the band row's tail. */
    gap: IntegerType,
    /** A decision's diamond, by the decision's key. */
    decision: StringType,
    /** The canvas, where nothing the card lands on lies under the pointer. */
    canvas: NullType,
});

/** Where a drag rests, decoded. */
export type FlowchartDropAt = ValueTypeOf<typeof FlowchartDropAtType>;

/** Where a drag rests, as its `CellRef` carries it. */
export const printDropAt: (at: FlowchartDropAt) => string = printFor(FlowchartDropAtType);

const parseDropAt = parseFor(FlowchartDropAtType);

/**
 * Where a drop's `CellRef` says the drag rests.
 *
 * @param text - The `CellRef`'s `row`
 * @returns Where it rests, or `undefined` when the text names nowhere — a coordinate another surface made
 */
export function readDropAt(text: string): FlowchartDropAt | undefined {
    const read = parseDropAt(text);
    return read.success ? read.value : undefined;
}

/** The canvas, where nothing a card lands on lies: where the canvas's drop cell rests before a drag says otherwise. */
export const ON_CANVAS: FlowchartDropAt = variant("canvas", null);

/** How near a transition's line a drag rests on it, either side, in px — wider than the line's 12px hit path, so nobody has to hit the line. */
export const LINK_PAD = 10;

/** How near a decision's diamond a drag rests on it: its half-diagonal, 11px, and a margin. */
export const DIAMOND_PAD = 16;

/** A point's place along the axis a lane's states stack on: LR's y, TD's x. */
const crossOf = (layout: FlowchartLayout, p: Pt): number => (layout.orientation === "TD" ? p.x : p.y);

/** A point's place along the axis the lanes stand on: LR's x, TD's y. */
const alongOf = (layout: FlowchartLayout, p: Pt): number => (layout.orientation === "TD" ? p.y : p.x);

/**
 * The row a new state takes in a band, at a point: after every state of the
 * band whose middle lies above the pointer — in TD, before it.
 *
 * @param layout - The laid-out flowchart
 * @param held - How many states the band draws
 * @param p - The point, in the canvas's px
 * @returns The row, from 0 — before the band's first state — to `held`, after its last
 */
export function rowAt(layout: FlowchartLayout, held: number, p: Pt): number {
    const middle = layout.rows.start + (layout.orientation === "TD" ? NODE_W : NODE_H) / 2;
    const above = Math.ceil((crossOf(layout, p) - middle) / layout.rows.pitch);
    return Math.max(0, Math.min(held, above));
}

/** How far a point is from a straight run of a transition's line. */
function distanceToRun(p: Pt, run: RouteSeg): number {
    const x = Math.max(Math.min(run.a.x, run.b.x), Math.min(p.x, Math.max(run.a.x, run.b.x)));
    const y = Math.max(Math.min(run.a.y, run.b.y), Math.min(p.y, Math.max(run.a.y, run.b.y)));
    return Math.hypot(p.x - x, p.y - y);
}

/**
 * The transition whose line runs nearest a point, within {@link LINK_PAD} —
 * one drawn as context left out; an in-place transition, folded into its
 * state's `↻` badge, has no line.
 *
 * @param layout - The laid-out flowchart
 * @param model - The view model: which transitions draw as context
 * @param p - The point
 * @returns Its key, or `undefined`
 */
export function linkAt(layout: FlowchartLayout, model: FlowchartModel, p: Pt): string | undefined {
    const context = new Set(model.links.filter((link) => link.dimmed).map((link) => link.key));
    let best: { key: string; d: number } | undefined;
    for (const route of layout.routes) {
        if (context.has(route.key)) continue;
        for (const run of route.segs) {
            const d = distanceToRun(p, run);
            if (d <= LINK_PAD && (best === undefined || d < best.d)) best = { key: route.key, d };
        }
    }
    return best?.key;
}

/**
 * The decision whose diamond lies under a point, within {@link DIAMOND_PAD}
 * of its middle — a transition naming a decision the Flowchart doesn't hold,
 * or one drawn as context, draws none a card lands on.
 *
 * @param layout - The laid-out flowchart
 * @param model - The view model: the decisions each transition names
 * @param p - The point
 * @returns The decision's key, or `undefined`
 */
export function diamondAt(layout: FlowchartLayout, model: FlowchartModel, p: Pt): string | undefined {
    const links = new Map(model.links.map((l) => [l.key, l] as const));
    for (const route of layout.routes) {
        const link = links.get(route.key);
        const trigger = link?.trigger;
        if (link === undefined || link.dimmed || trigger === undefined || !model.triggers.has(trigger)) continue;
        if (Math.abs(p.x - route.mid.x) + Math.abs(p.y - route.mid.y) <= DIAMOND_PAD) return trigger;
    }
    return undefined;
}

/**
 * The lane whose header holds a point: the band's strip before its first row
 * — across the top in LR, down the side in TD. Only a lane of the app's has a
 * header a card lands on: never *No lane*, nor the one band of a Flowchart
 * given no lanes.
 *
 * @param layout - The laid-out flowchart
 * @param model - The view model
 * @param p - The point
 * @returns The lane's key, or `undefined`
 */
export function headerAt(layout: FlowchartLayout, model: FlowchartModel, p: Pt): string | undefined {
    if (crossOf(layout, p) >= layout.rows.start) return undefined;
    const key = laneAt(layout, p);
    const lane = key === null ? undefined : model.lanes.find((l) => keyEqual(l.key, key));
    return lane?.band === "lane" ? lane.key : undefined;
}

/**
 * Where a new lane lands at a point: before the first lane of the app's whose
 * middle lies past the pointer — after the last, the band row's tail. A
 * Flowchart given no lanes has no gap.
 *
 * @param layout - The laid-out flowchart
 * @param model - The view model
 * @param p - The point
 * @returns The gap, from 0 to the lanes' count; `undefined` with no lanes given
 */
export function gapAt(layout: FlowchartLayout, model: FlowchartModel, p: Pt): number | undefined {
    if (model.standIn) return undefined;
    const lanes = model.lanes.filter((lane) => lane.band === "lane").length;
    const along = alongOf(layout, p);
    const td = layout.orientation === "TD";
    for (let i = 0; i < lanes; i++) {
        const band = layout.lanes[i];
        if (band === undefined) break;
        const start = td ? band.y : band.x;
        const size = td ? band.h : band.w;
        if (along < start + size / 2) return i;
    }
    return lanes;
}

/**
 * Where a gap stands along the lanes' axis: the start of the lane it lands
 * before, or the end of the last lane of the app's.
 *
 * @param layout - The laid-out flowchart
 * @param at - The gap
 * @returns Its place, in the canvas's px — LR's x, TD's y
 */
export function gapLine(layout: FlowchartLayout, at: number): number {
    const td = layout.orientation === "TD";
    const before = layout.lanes[at];
    if (before !== undefined) return td ? before.y : before.x;
    const last = layout.lanes[at - 1];
    if (last === undefined) return 0;
    return td ? last.y + last.h : last.x + last.w;
}

/** The states a band draws, in its order: its ghosts left out — a state drawn as context keeps its row. */
function bandStates(model: FlowchartModel, band: number): ModelNode[] {
    return model.nodes.filter((node) => node.laneIndex === band && !node.ghost).sort((a, b) => a.laneOrder - b.laneOrder);
}

/**
 * Where a drag rests at a point of the canvas, for a card that lands on what
 * it names: a band and the row a new state takes in it ({@link rowAt}) —
 * never *No lane*; a state — its card, or as near as `connect.ts`' drop pad —
 * never a ghost; a transition near its line; a lane's header; a gap between
 * the lanes ({@link gapAt}); a decision's diamond. A row drawn as context
 * takes no card. Anywhere else, the canvas.
 *
 * @param lands - What the card lands on
 * @param layout - The laid-out flowchart
 * @param model - The view model
 * @param p - The point, in the canvas's px
 * @returns Where the drag rests
 */
export function dropAtPoint(lands: FlowchartLands, layout: FlowchartLayout, model: FlowchartModel, p: Pt): FlowchartDropAt {
    switch (lands) {
        case "lane": {
            const key = laneAt(layout, p);
            const index = key === null ? -1 : model.lanes.findIndex((l) => keyEqual(l.key, key));
            const band = model.lanes[index];
            if (band === undefined || band.band === "noLane") return ON_CANVAS;
            return variant("lane", { lane: band.key, row: BigInt(rowAt(layout, bandStates(model, index).length, p)) });
        }
        case "state": {
            const key = dropTargetAt(layout, p);
            const node = key === null ? undefined : model.nodesByKey.get(key);
            return node === undefined || node.ghost || node.dimmed ? ON_CANVAS : variant("state", node.key);
        }
        case "transition": {
            const key = linkAt(layout, model, p);
            return key === undefined ? ON_CANVAS : variant("transition", key);
        }
        case "header": {
            const key = headerAt(layout, model, p);
            return key === undefined ? ON_CANVAS : variant("header", key);
        }
        case "gap": {
            const at = gapAt(layout, model, p);
            return at === undefined ? ON_CANVAS : variant("gap", BigInt(at));
        }
        case "decision": {
            const key = diamondAt(layout, model, p);
            return key === undefined ? ON_CANVAS : variant("decision", key);
        }
    }
}

// ── What a drop does ──────────────────────────────────────────────────────

/** What a drop reads of the Flowchart as it stands. */
export interface FlowchartDropContext {
    /** What the Flowchart draws now, the drafts in place. */
    readonly model: FlowchartModel;
    /** Whether a kind is edited at all: bound with its patch door, and the Flowchart not read only (R13). */
    readonly editable: (sort: FlowchartSort) => boolean;
    /** Whether a kind takes an edit now: no Save on its way, nothing the canvas draws standing in. */
    readonly available: (sort: FlowchartSort) => boolean;
    /** A kind's name, as a sentence writes it (`state`). */
    readonly kindName: (sort: FlowchartSort) => string;
}

/** Why a drop is refused where it rests: in its words, or — what it lands on having left the drawing — in none. */
export type FlowchartDropRefusal = { readonly why: "gone" } | FlowchartDropRefusalWord;

/** What a drop does where it rests. */
export type FlowchartDropPlan =
    /** A state added in a band at a row, from a card's values, and where its words say it lands. */
    | { readonly kind: "addState"; readonly band: string; readonly row: number; readonly values: Uint8Array; readonly place: FlowchartDropPlaceWord }
    /** A transition given a card's values, and what it is, in words. */
    | { readonly kind: "retype"; readonly key: string; readonly values: Uint8Array; readonly what: FlowchartDropWhatWord }
    /** A lane added among the lanes, from a card's values, and where its words say it lands. */
    | { readonly kind: "addLane"; readonly at: number; readonly values: Uint8Array; readonly place: FlowchartDropPlaceWord }
    /** An author's card's fields set on a row of a kind, and what it is, in words. */
    | { readonly kind: "set"; readonly sort: FlowchartSort; readonly key: string; readonly sets: FlowchartFieldWrites; readonly what: FlowchartDropWhatWord }
    | { readonly kind: "refused"; readonly why: FlowchartDropRefusal };

const refused = (why: FlowchartDropRefusal): FlowchartDropPlan => ({ kind: "refused", why });
const GONE: FlowchartDropPlan = refused({ why: "gone" });

/** A state's card on a band at a row: where it lands among the band's states. */
function planState(model: FlowchartModel, band: string, row: number, values: Uint8Array): FlowchartDropPlan {
    const index = model.lanes.findIndex((lane) => keyEqual(lane.key, band));
    const lane = model.lanes[index];
    if (lane === undefined) return GONE;
    if (lane.band === "noLane") return refused({ why: "onto", lands: "lane" });
    const states = bandStates(model, index);
    const r = Math.max(0, Math.min(row, states.length));
    const name = lane.band === "lane" ? lane.label : undefined;
    const above = r > 0 ? states[r - 1]!.key : undefined;
    const place: FlowchartDropPlaceWord = above !== undefined ? { place: "after", lane: name, after: above }
        : states.length > 0 ? { place: "start", lane: name } : { place: "in", lane: name };
    return { kind: "addState", band: lane.key, row: r, values, place };
}

/** A lane's card at a gap: where it lands among the lanes. */
function planLane(model: FlowchartModel, at: number, values: Uint8Array): FlowchartDropPlan {
    const lanes = model.lanes.filter((lane) => lane.band === "lane");
    const i = Math.max(0, Math.min(at, lanes.length));
    const before = lanes[i];
    return { kind: "addLane", at: i, values, place: before === undefined ? { place: "end" } : { place: "before", lane: before.label } };
}

/** An author's card on a row of its kind, where the drag rests: what it is, in words, or why it is refused. */
function planSet(card: Extract<FlowchartDropCard, { does: "set" }>, at: FlowchartDropAt, model: FlowchartModel): FlowchartDropPlan {
    const set = (key: string, what: FlowchartDropWhatWord): FlowchartDropPlan => ({ kind: "set", sort: card.sort, key, sets: card.sets, what });
    switch (card.sort) {
        case "states": {
            if (at.type !== "state") return refused({ why: "onto", lands: "state" });
            const node = model.nodesByKey.get(at.value);
            return node === undefined || node.ghost || node.dimmed ? GONE : set(node.key, { what: "state", key: node.key });
        }
        case "transitions": {
            if (at.type !== "transition") return refused({ why: "onto", lands: "transition" });
            return whatTransition(model, at.value, (what) => set(at.value, what));
        }
        case "lanes": {
            if (at.type !== "header") return refused({ why: "onto", lands: "header" });
            const lane = model.lanes.find((l) => keyEqual(l.key, at.value));
            return lane === undefined || lane.band !== "lane" ? GONE : set(lane.key, { what: "header", lane: lane.label });
        }
        case "decisions": {
            if (at.type !== "decision") return refused({ why: "onto", lands: "decision" });
            const decision = model.triggers.get(at.value);
            return decision === undefined ? GONE : set(decision.key, { what: "decision", label: decision.label });
        }
    }
}

/** A transition the Flowchart draws as itself, by its ends in words — or gone. */
function whatTransition(model: FlowchartModel, key: string, plan: (what: FlowchartDropWhatWord) => FlowchartDropPlan): FlowchartDropPlan {
    if (!drawsTransition(model, key)) return GONE;
    const link = model.links.find((l) => keyEqual(l.key, key));
    if (link !== undefined) return plan({ what: "transition", from: link.from, to: link.to });
    const node = model.nodes.find((n) => n.inPlaceKeys.some((k) => keyEqual(k, key)));
    return node === undefined ? GONE : plan({ what: "transition", from: node.key, to: node.key });
}

/**
 * What a drop does where it rests — see the module docs. A card of a kind
 * read only, or of a kind taking no edit now, is refused wherever it rests;
 * otherwise a card is refused anywhere but what it lands on, and says nothing
 * where that has left the drawing.
 *
 * @param card - The card dragged
 * @param at - Where the drag rests
 * @param ctx - The Flowchart as it stands
 * @returns What the drop does, or why it is refused
 */
export function planDrop(card: FlowchartDropCard, at: FlowchartDropAt, ctx: FlowchartDropContext): FlowchartDropPlan {
    const sort = cardSort(card);
    if (!ctx.editable(sort)) return refused({ why: "readOnly", kind: ctx.kindName(sort) });
    if (!ctx.available(sort)) return refused({ why: "busy", kind: ctx.kindName(sort) });
    const model = ctx.model;
    switch (card.does) {
        case "addState":
            return at.type === "lane" ? planState(model, at.value.lane, Number(at.value.row), card.values) : refused({ why: "onto", lands: "lane" });
        case "retype":
            return at.type === "transition"
                ? whatTransition(model, at.value, (what) => ({ kind: "retype", key: at.value, values: card.values, what }))
                : refused({ why: "onto", lands: "transition" });
        case "addLane":
            return at.type === "gap" && !model.standIn ? planLane(model, Number(at.value), card.values) : refused({ why: "onto", lands: "gap" });
        case "set":
            return planSet(card, at, model);
    }
}

/**
 * The edits a plan writes, one step of the history: a state from the card's
 * values where it lands; a transition's values; a lane from the card's values
 * where it lands; an author's card's fields — none for a refusal.
 *
 * @param plan - The plan
 * @param holding - What the Flowchart holds now
 * @returns The edits and the key of the row they add; `undefined` for a refusal, or a kind taking no gesture
 */
export function dropEdits(plan: FlowchartDropPlan, holding: FlowchartHolding): GestureEdits | undefined {
    switch (plan.kind) {
        case "refused": return undefined;
        case "addState": return dropState(holding, plan.band, plan.row, plan.values);
        case "retype": return dropTransition(holding, plan.key, plan.values);
        case "addLane": return dropLane(holding, plan.at, plan.values);
        case "set": return setFields(holding, plan.sort, plan.key, plan.sets);
    }
}

/**
 * What a drop brings onto the canvas, which it selects: the state or the lane
 * it added; nothing for a drop on a row.
 *
 * @param plan - The plan
 * @param edits - What it wrote
 * @returns The selection, or `undefined`
 */
export function droppedSelection(plan: FlowchartDropPlan, edits: GestureEdits): FlowchartSelection | undefined {
    if (edits.key === undefined) return undefined;
    if (plan.kind === "addState") return { kind: "state", key: edits.key };
    if (plan.kind === "addLane") return { kind: "lane", key: edits.key };
    return undefined;
}

// ── ⏎ on a card ───────────────────────────────────────────────────────────

/**
 * Where ⏎ on a card drops it: on the canvas's selection. A state's card lands
 * after the selected state, in its band; with a lane selected, at the end of
 * that lane; with neither, at the end of the first band that takes states. A
 * lane's card lands after the selected lane, else at the band row's tail. Any
 * other card lands on the selected state, transition, decision or lane when it
 * lands on that. A selection the drawing no longer holds is none.
 *
 * @param lands - What the card lands on
 * @param selection - What the canvas has selected
 * @param model - What the Flowchart draws now
 * @returns Where it drops — the canvas, where the selection takes no such card
 */
export function enterAt(lands: FlowchartLands, selection: FlowchartSelection | null, model: FlowchartModel): FlowchartDropAt {
    const picked = (kind: "state" | "link" | "trigger" | "lane"): string | undefined =>
        (selection !== null && selection.kind === kind ? selection.key : undefined);
    const laneOf = (key: string | undefined) => (key === undefined ? -1 : model.lanes.findIndex((l) => keyEqual(l.key, key) && l.band === "lane"));
    switch (lands) {
        case "lane": {
            const key = picked("state");
            const node = key === undefined ? undefined : model.nodesByKey.get(key);
            if (node !== undefined && !node.ghost && !node.dimmed && model.lanes[node.laneIndex]?.band !== "noLane") {
                const states = bandStates(model, node.laneIndex);
                const row = states.findIndex((state) => keyEqual(state.key, node.key)) + 1;
                return variant("lane", { lane: model.lanes[node.laneIndex]!.key, row: BigInt(row) });
            }
            // The selected lane, or else the first band that takes states: at its end.
            const chosen = laneOf(picked("lane"));
            const index = chosen >= 0 ? chosen : model.lanes.findIndex((lane) => lane.band !== "noLane");
            const band = model.lanes[index];
            if (band === undefined) return ON_CANVAS;
            return variant("lane", { lane: band.key, row: BigInt(bandStates(model, index).length) });
        }
        case "gap": {
            if (model.standIn) return ON_CANVAS;
            const chosen = laneOf(picked("lane"));
            return variant("gap", BigInt(chosen >= 0 ? chosen + 1 : model.lanes.filter((lane) => lane.band === "lane").length));
        }
        case "state": {
            const key = picked("state");
            const node = key === undefined ? undefined : model.nodesByKey.get(key);
            return node !== undefined && !node.ghost && !node.dimmed ? variant("state", node.key) : ON_CANVAS;
        }
        case "transition": {
            const key = picked("link");
            return key !== undefined && drawsTransition(model, key) ? variant("transition", key) : ON_CANVAS;
        }
        case "decision": {
            const key = picked("trigger");
            return key !== undefined && model.triggers.has(key) ? variant("decision", key) : ON_CANVAS;
        }
        case "header": {
            const key = picked("lane");
            return laneOf(key) >= 0 ? variant("header", key!) : ON_CANVAS;
        }
    }
}

// ── Its marks ─────────────────────────────────────────────────────────────

/** What the canvas marks while a drag rests where it lands: the band and the row a state takes, the gap a lane lands in, a lane's header, or what a card sets its fields on. */
export type FlowchartDropMark =
    | { readonly kind: "lane"; readonly lane: string; readonly row: number }
    | { readonly kind: "gap"; readonly at: number }
    | { readonly kind: "header"; readonly lane: string }
    | { readonly kind: "state" | "transition" | "decision"; readonly key: string };

/**
 * What the canvas marks for a plan: the band a state lands in and its row,
 * the gap a lane lands in, the lane whose header a card sets, or the state,
 * transition or decision a card lands on — nothing for a refusal.
 *
 * @param plan - The plan
 * @returns The mark, or `undefined`
 */
export function markOf(plan: FlowchartDropPlan): FlowchartDropMark | undefined {
    switch (plan.kind) {
        case "refused": return undefined;
        case "addState": return { kind: "lane", lane: plan.band, row: plan.row };
        case "addLane": return { kind: "gap", at: plan.at };
        case "retype": return { kind: "transition", key: plan.key };
        case "set": {
            switch (plan.sort) {
                case "states": return { kind: "state", key: plan.key };
                case "transitions": return { kind: "transition", key: plan.key };
                case "lanes": return { kind: "header", lane: plan.key };
                case "decisions": return { kind: "decision", key: plan.key };
            }
        }
    }
}

/**
 * Whether two marks are one: what the canvas draws need not move.
 *
 * @param a - A mark, or none
 * @param b - Another, or none
 * @returns Whether they mark the same place
 */
export function markEqual(a: FlowchartDropMark | undefined, b: FlowchartDropMark | undefined): boolean {
    if (a === undefined || b === undefined) return a === undefined && b === undefined;
    switch (a.kind) {
        case "lane": return b.kind === "lane" && keyEqual(a.lane, b.lane) && a.row === b.row;
        case "gap": return b.kind === "gap" && a.at === b.at;
        case "header": return b.kind === "header" && keyEqual(a.lane, b.lane);
        default: return b.kind === a.kind && keyEqual(a.key, (b as { readonly key: string }).key);
    }
}

// ── Its words ─────────────────────────────────────────────────────────────

/**
 * What the ghost says of a plan: where a state lands — `after SRT in Sort` —
 * where a lane lands — `before Sort` — or what a card sets its fields on —
 * `onto SRT → LDD` — or, red, why it can't: `Drop onto a transition`.
 *
 * @param plan - The plan
 * @param m - The Flowchart's messages
 * @returns The caption; `undefined` for a refusal that says nothing
 */
export function dropCaption(plan: FlowchartDropPlan, m: FlowchartMessages): string | undefined {
    switch (plan.kind) {
        case "addState":
        case "addLane": return m.dropPlace(plan.place);
        case "retype":
        case "set": return m.dropOnto({ what: m.dropWhat(plan.what) });
        case "refused": return plan.why.why === "gone" ? undefined : m.dropRefused(plan.why);
    }
}

/**
 * Why a plan is refused, as the footer says it for a card's ⏎.
 *
 * @param plan - The plan
 * @param m - The Flowchart's messages
 * @returns The words; `undefined` for a plan that lands, or a refusal that says nothing
 */
export function dropRefusal(plan: FlowchartDropPlan, m: FlowchartMessages): string | undefined {
    return plan.kind === "refused" && plan.why.why !== "gone" ? m.dropRefused(plan.why) : undefined;
}

/**
 * Where a plan lands, as a screen reader hears the drag layer say it — `Sort,
 * after SRT`, `SRT → LDD` — or, refused, the canvas.
 *
 * @param plan - The plan
 * @param m - The Flowchart's messages
 * @returns The name
 */
export function dropName(plan: FlowchartDropPlan, m: FlowchartMessages): string {
    switch (plan.kind) {
        case "addState":
        case "addLane": return m.dropPlaceName(plan.place);
        case "retype":
        case "set": return m.dropWhat(plan.what);
        case "refused": return m.dropCanvas();
    }
}

/**
 * A drop's step in the history, and its Save's — `Drop Held on Sort, after
 * SRT`.
 *
 * @param plan - The plan: one that lands
 * @param card - The card dropped
 * @param m - The Flowchart's messages
 * @returns The name
 */
export function dropLabel(plan: FlowchartDropPlan, card: FlowchartDropCard, m: FlowchartMessages): string {
    return m.dropLabel({ card: card.label, onto: dropName(plan, m) });
}

// ── The canvas's part ─────────────────────────────────────────────────────

/**
 * What the canvas hands the drag layer as its one drop cell: built by the
 * frame and held still while the Flowchart takes drops, its functions reading
 * the Flowchart as it stands. The canvas works out where a drag rests from its
 * own drawing, and marks it.
 */
export interface FlowchartCanvasDrop {
    /** The surface the cell registers on: the Flowchart's drop target. */
    readonly surface: string;
    /** What a drag carries, as the Flowchart reads it — a card a tab of its library drops — or `undefined`. */
    readonly cardOf: (payload: DragPayload) => FlowchartDropCard | undefined;
    /** What a drop of a card where a drag rests does, over the Flowchart as it stands. */
    readonly plan: (card: FlowchartDropCard, at: FlowchartDropAt) => FlowchartDropPlan;
    /** The veto: whether the drop a candidate event makes lands. */
    readonly canDrop: DropVeto;
    /** What the ghost says where the drag rests, and that place's name for the announcements. */
    readonly options: Required<Pick<DropCellOptions, "caption" | "name">>;
}
