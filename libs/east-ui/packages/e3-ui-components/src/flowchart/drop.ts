/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * The flowchart's drops (#1249, `Flowchart Builder Spec.md` §9.8, §10,
 * FB30–FB34) — pure and React-free: what a library card does where it lands,
 * decided as data before anything is drawn or written. The frame runs a plan
 * as one transaction of the open flow's session, and the canvas draws where
 * it lands.
 *
 * - **What is dragged** ({@link FlowchartDropCard}, {@link dropHostOf}): a
 *   card of a library tab that drops — a state template, which lands on a
 *   lane; a transition template, on a transition; an author's card, on what
 *   its drop's type names: a state, a transition, a lane's header or a
 *   decision's diamond.
 * - **Where a drag rests** ({@link FlowchartDropAtType}, {@link dropAtPoint}):
 *   what lies under the pointer of the kind the card lands on — a lane, and
 *   the row a new state takes in it, after the states above the pointer; a
 *   state; a transition, near its line; a lane's header; a decision's diamond
 *   — or the canvas, where nothing it lands on lies. The shared drag
 *   grammar's `CellRef` carries it in its `row`, printed.
 * - **What a drop does** ({@link planDrop}, {@link dropFlow}): a state added
 *   at that row, seeded with the card's fields over a state's defaults, its
 *   key the card's — made unique (`HLD-2`) where the flow holds it, or minted
 *   (`state-<n>`) where the card sets none (FB31); the card's fields set on
 *   what it lands on (FB32, FB33); or refused, with the reason the ghost says
 *   in red — anywhere but what the card lands on, and over a flowchart that
 *   edits nothing.
 * - **⏎ on a card** ({@link enterAt}): a drop on the canvas's selection
 *   (FB34) — a state template after the selected state, in its lane, at the
 *   end of the selected lane (#1250), or at the end of the first lane with
 *   neither selected; any other card on what is selected, when that is what
 *   it lands on — a lane's card on the lane a click on its header selected
 *   (#1250).
 * - **Its words** ({@link dropCaption}, {@link dropName}, {@link dropRefusal},
 *   {@link dropLabel}) and **its marks** ({@link markOf}): the lane it lands
 *   in and the row, or what it sets its fields on.
 *
 * @packageDocumentation
 */

import { IntegerType, NullType, StringType, StructType, VariantType, equalFor, none, parseFor, printFor, variant, type ValueTypeOf } from "@elaraai/east";
import { getSomeorUndefined, type DragPayload, type DropCellOptions, type DropVeto } from "@elaraai/east-ui-components";
import { dropTargetAt, laneAt } from "./connect.js";
import {
    insertState, linkKeyOf, mintKey, patched, setDecision, setLane, setLink, setState, uniqueKey,
    type FlowchartDecisionPatch, type FlowchartLanePatch, type FlowchartLinkPatch, type FlowchartStatePatch,
} from "./edits.js";
import { NODE_H, NODE_W, type FlowchartLayout, type Pt, type RouteSeg } from "./layout.js";
import type { FlowchartDropPlaceWord, FlowchartDropRefusalWord, FlowchartDropWhatWord, FlowchartLandsWord, FlowchartMessages } from "./messages.js";
import type { FlowchartFlowValue, FlowchartLaneValue, FlowchartModel, FlowchartStateValue, FlowchartValue } from "./model.js";
import type { FlowchartSelection } from "./selection.js";

const keyEqual = equalFor(StringType);

// ── What is dragged ───────────────────────────────────────────────────────

/** What a library card lands on: a lane (a state template), a state, a transition, a lane's header or a decision's diamond. */
export type FlowchartLands = FlowchartLandsWord;

/**
 * A card the canvas takes, as the flowchart reads it: its name, what it lands
 * on, and the fields its drop sets there — a state template's the state it
 * adds, over a state's defaults.
 */
export type FlowchartDropCard =
    | { readonly lands: "lane" | "state"; readonly label: string; readonly sets: FlowchartStatePatch }
    | { readonly lands: "transition"; readonly label: string; readonly sets: FlowchartLinkPatch }
    | { readonly lands: "header"; readonly label: string; readonly sets: FlowchartLanePatch }
    | { readonly lands: "decision"; readonly label: string; readonly sets: FlowchartDecisionPatch };

/** One tab the payload lists, decoded. */
type FlowchartTabValue = FlowchartValue["library"][number];

/** What the canvas takes dropped: its drop target, and each library whose cards drop — its cards by key. */
export interface FlowchartDropHost {
    /** The flowchart's drop target: the surface its canvas registers on. */
    readonly surface: string;
    /** Each library whose cards drop, by its id: its cards, by key. */
    readonly libraries: ReadonlyMap<string, ReadonlyMap<string, FlowchartDropCard>>;
}

/** A tab's cards by key, each read as a card that drops. */
function byKey<C extends { readonly key: string }>(cards: readonly C[], card: (c: C) => FlowchartDropCard): ReadonlyMap<string, FlowchartDropCard> {
    return new Map(cards.map((c) => [c.key, card(c)] as const));
}

/**
 * The cards of a tab that drops, by key: the templates', and an author's tab's
 * when it declares a `drop` — by what its drop's type names. The Flows tab and
 * an author's tab with no `drop` drop nothing.
 *
 * @param tab - The tab
 * @returns Its cards, or `undefined` for a tab whose cards drop nothing
 */
function cardsOf(tab: FlowchartTabValue): ReadonlyMap<string, FlowchartDropCard> | undefined {
    switch (tab.type) {
        case "flows": return undefined;
        case "states": return byKey(tab.value.cards, (c) => ({ lands: "lane", label: c.label, sets: c.sets }));
        case "transitions": return byKey(tab.value.cards, (c) => ({ lands: "transition", label: c.label, sets: c.sets }));
        case "tab": {
            const lands = tab.value.lands;
            switch (lands.type) {
                case "none": return undefined;
                case "state": return byKey(lands.value, (c) => ({ lands: "state", label: c.label, sets: c.sets }));
                case "transition": return byKey(lands.value, (c) => ({ lands: "transition", label: c.label, sets: c.sets }));
                case "lane": return byKey(lands.value, (c) => ({ lands: "header", label: c.label, sets: c.sets }));
                case "decision": return byKey(lands.value, (c) => ({ lands: "decision", label: c.label, sets: c.sets }));
            }
        }
    }
}

/**
 * What the canvas takes dropped, from the tabs the payload lists: each tab
 * whose cards drop, under the library its cards drag from.
 *
 * @param surface - The flowchart's drop target
 * @param tabs - The tabs, each with the library its cards drag from
 * @returns What the canvas takes
 */
export function dropHostOf(surface: string, tabs: ReadonlyArray<readonly [library: string, tab: FlowchartTabValue]>): FlowchartDropHost {
    const libraries = new Map<string, ReadonlyMap<string, FlowchartDropCard>>();
    for (const [library, tab] of tabs) {
        const cards = cardsOf(tab);
        if (cards !== undefined) libraries.set(library, cards);
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

/** Where a drag rests over the canvas, for what it carries — what a flowchart's drop `CellRef` names in its `row`, printed. */
export const FlowchartDropAtType = VariantType({
    /** A lane, by its key, and the row a new state takes in it: after the states above the pointer. */
    lane: StructType({ lane: StringType, row: IntegerType }),
    /** A state, by its key. */
    state: StringType,
    /** A transition, by the key it goes by. */
    transition: StringType,
    /** A lane's header, by the lane's key. */
    header: StringType,
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

/**
 * The row a new state takes in a lane, at a point: after every state of the
 * lane whose middle lies above the pointer — in TD, before it.
 *
 * @param layout - The laid-out flow
 * @param held - How many states the lane draws
 * @param p - The point, in the canvas's px
 * @returns The row, from 0 — before the lane's first state — to `held`, after its last
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
 * an in-place transition, folded into its state's `↻` badge, has no line.
 *
 * @param layout - The laid-out flow
 * @param p - The point
 * @returns The key it goes by, or `undefined`
 */
export function linkAt(layout: FlowchartLayout, p: Pt): string | undefined {
    let best: { key: string; d: number } | undefined;
    for (const route of layout.routes) {
        for (const run of route.segs) {
            const d = distanceToRun(p, run);
            if (d <= LINK_PAD && (best === undefined || d < best.d)) best = { key: route.key, d };
        }
    }
    return best?.key;
}

/**
 * The decision whose diamond lies under a point, within {@link DIAMOND_PAD}
 * of its middle — a transition naming a decision the flow doesn't have draws
 * none.
 *
 * @param layout - The laid-out flow
 * @param model - The flow's view model: the decisions each transition names
 * @param p - The point
 * @returns The decision's key, or `undefined`
 */
export function diamondAt(layout: FlowchartLayout, model: FlowchartModel, p: Pt): string | undefined {
    const links = new Map(model.links.map((l) => [l.key, l] as const));
    for (const route of layout.routes) {
        const trigger = links.get(route.key)?.trigger;
        if (trigger === undefined || !model.triggers.has(trigger)) continue;
        if (Math.abs(p.x - route.mid.x) + Math.abs(p.y - route.mid.y) <= DIAMOND_PAD) return trigger;
    }
    return undefined;
}

/**
 * The lane whose header holds a point: the band's strip before its first row
 * — across the top in LR, down the side in TD.
 *
 * @param layout - The laid-out flow
 * @param model - The flow's view model: never the stand-in band of a flow with no lane
 * @param p - The point
 * @returns The lane's key, or `undefined`
 */
export function headerAt(layout: FlowchartLayout, model: FlowchartModel, p: Pt): string | undefined {
    if (model.standIn || crossOf(layout, p) >= layout.rows.start) return undefined;
    return laneAt(layout, p) ?? undefined;
}

/**
 * Where a drag rests at a point of the canvas, for a card that lands on what
 * it names: a lane and the row a new state takes in it ({@link rowAt}); a
 * state — its card, or as near as `connect.ts`'s drop pad — never an
 * unresolved transition's ghost; a transition near its line; a lane's header;
 * a decision's diamond. Anywhere else, the canvas.
 *
 * @param lands - What the card lands on
 * @param layout - The laid-out flow
 * @param model - The flow's view model
 * @param p - The point, in the canvas's px
 * @returns Where the drag rests
 */
export function dropAtPoint(lands: FlowchartLands, layout: FlowchartLayout, model: FlowchartModel, p: Pt): FlowchartDropAt {
    switch (lands) {
        case "lane": {
            const key = model.standIn ? null : laneAt(layout, p);
            const index = key === null ? -1 : layout.lanes.findIndex((l) => keyEqual(l.key, key));
            if (key === null || index < 0) return ON_CANVAS;
            const held = model.nodes.filter((n) => !n.ghost && n.laneIndex === index).length;
            return variant("lane", { lane: key, row: BigInt(rowAt(layout, held, p)) });
        }
        case "state": {
            const key = dropTargetAt(layout, p);
            const node = key === null ? undefined : model.nodesByKey.get(key);
            return node === undefined || node.ghost ? ON_CANVAS : variant("state", node.key);
        }
        case "transition": {
            const key = linkAt(layout, p);
            return key === undefined ? ON_CANVAS : variant("transition", key);
        }
        case "header": {
            const key = headerAt(layout, model, p);
            return key === undefined ? ON_CANVAS : variant("header", key);
        }
        case "decision": {
            const key = diamondAt(layout, model, p);
            return key === undefined ? ON_CANVAS : variant("decision", key);
        }
    }
}

// ── What a drop does ──────────────────────────────────────────────────────

/** What a drop reads of the flowchart as it stands. */
export interface FlowchartDropContext {
    /** The open flow as its session holds it now; `undefined` while no flow is open. */
    readonly flow: FlowchartFlowValue | undefined;
    /** Whether the flowchart edits: a record, or the host's flows given `onApply`, and not read only. */
    readonly edits: boolean;
    /** Whether its session takes a gesture now: no Save in flight, its drafts not out of date. */
    readonly available: boolean;
}

/** Why a drop is refused where it rests: in its words, or — what it lands on having left the flow — in none. */
export type FlowchartDropRefusal = { readonly why: "gone" } | FlowchartDropRefusalWord;

/** A card's fields set on what it lands on: a state, a transition, a lane by its header, or a decision. */
export type FlowchartDropSet =
    | { readonly onto: "state"; readonly key: string; readonly sets: FlowchartStatePatch }
    | { readonly onto: "transition"; readonly key: string; readonly sets: FlowchartLinkPatch }
    | { readonly onto: "header"; readonly key: string; readonly sets: FlowchartLanePatch }
    | { readonly onto: "decision"; readonly key: string; readonly sets: FlowchartDecisionPatch };

/** What a drop does where it rests. */
export type FlowchartDropPlan =
    /** A state added in a lane at a row (FB31): its place among the flow's states, the state, and where its words say it lands. */
    | { readonly kind: "add"; readonly lane: string; readonly row: number; readonly index: number; readonly state: FlowchartStateValue; readonly place: FlowchartDropPlaceWord }
    /** A card's fields set on what it lands on (FB32, FB33), and what that is, in words. */
    | { readonly kind: "set"; readonly set: FlowchartDropSet; readonly what: FlowchartDropWhatWord }
    | { readonly kind: "refused"; readonly why: FlowchartDropRefusal };

const refused = (why: FlowchartDropRefusal): FlowchartDropPlan => ({ kind: "refused", why });
const GONE: FlowchartDropPlan = refused({ why: "gone" });

/** A lane's name, as the words say it: its label, else its key. */
const laneName = (lane: FlowchartLaneValue): string => getSomeorUndefined(lane.label) ?? lane.key;

/**
 * The lane the canvas draws each state in, by its place among the flow's
 * lanes: the lane its `lane` names — the last of that key — else, naming no
 * lane the flow has, the last lane (`model.ts`'s rule).
 *
 * @param flow - The flow
 * @returns Each state's lane, and each lane key's
 */
function drawnLanes(flow: FlowchartFlowValue): { readonly of: (state: FlowchartStateValue) => number; readonly lane: (key: string) => number | undefined } {
    const index = new Map(flow.lanes.map((l, i) => [l.key, i] as const));
    const last = Math.max(flow.lanes.length - 1, 0);
    return { of: (s) => index.get(s.lane) ?? last, lane: (key) => index.get(key) };
}

/**
 * A state template's drop on a lane at a row (FB31): the state seeded with
 * the card's fields over a state's defaults, in the lane it is dropped on;
 * its key the card's, made unique where the flow holds it, or minted where
 * the card sets none; placed among the flow's states before the state that
 * stands at that row, or after the lane's last.
 */
function planAdd(sets: FlowchartStatePatch, laneKey: string, row: number, flow: FlowchartFlowValue): FlowchartDropPlan {
    const lanes = drawnLanes(flow);
    const li = lanes.lane(laneKey);
    if (li === undefined) return GONE;
    // The lane's states, in the order it draws them: their places among the flow's states.
    const places: number[] = [];
    flow.states.forEach((s, i) => { if (lanes.of(s) === li) places.push(i); });
    const r = Math.max(0, Math.min(row, places.length));
    const name = laneName(flow.lanes[li]!);
    const above = r > 0 ? flow.states[places[r - 1]!]!.key : undefined;
    const place: FlowchartDropPlaceWord = above !== undefined ? { place: "after", lane: name, after: above }
        : places.length > 0 ? { place: "start", lane: name } : { place: "in", lane: name };
    const taken = (key: string): boolean => flow.states.some((s) => keyEqual(s.key, key));
    const wanted = getSomeorUndefined(sets.key);
    const key = wanted !== undefined && !keyEqual(wanted, "") ? uniqueKey(wanted, taken) : mintKey("state", flow.states.length + 1, taken);
    const seeded = patched<FlowchartStateValue>({ key, label: none, lane: laneKey, members: none, notes: none }, sets);
    return {
        kind: "add",
        lane: laneKey,
        row: r,
        index: r < places.length ? places[r]! : flow.states.length,
        // Where it lands, as the card was dropped: the lane it lies in, under the key it takes.
        state: { ...seeded, key, lane: laneKey },
        place,
    };
}

/**
 * What a drop does where it rests — see the module docs. A flowchart with no
 * flow open, one that edits nothing, and one whose session takes no gesture
 * now refuse every drop; otherwise a card is refused anywhere but what it
 * lands on, and says nothing where that has left the flow.
 *
 * @param card - The card dragged
 * @param at - Where the drag rests
 * @param ctx - The flowchart as it stands
 * @returns What the drop does, or why it is refused
 */
export function planDrop(card: FlowchartDropCard, at: FlowchartDropAt, ctx: FlowchartDropContext): FlowchartDropPlan {
    const flow = ctx.flow;
    if (flow === undefined) return refused({ why: "noFlow" });
    if (!ctx.edits) return refused({ why: "readOnly" });
    if (!ctx.available) return refused({ why: "busy" });
    switch (card.lands) {
        case "lane":
            return at.type === "lane" ? planAdd(card.sets, at.value.lane, Number(at.value.row), flow) : refused({ why: "onto", lands: "lane" });
        case "state": {
            if (at.type !== "state") return refused({ why: "onto", lands: "state" });
            const key = at.value;
            return flow.states.some((s) => keyEqual(s.key, key))
                ? { kind: "set", set: { onto: "state", key, sets: card.sets }, what: { what: "state", key } } : GONE;
        }
        case "transition": {
            if (at.type !== "transition") return refused({ why: "onto", lands: "transition" });
            const key = at.value;
            const link = flow.links.find((l, i) => keyEqual(linkKeyOf(l, i), key));
            return link === undefined ? GONE : { kind: "set", set: { onto: "transition", key, sets: card.sets }, what: { what: "transition", from: link.from, to: link.to } };
        }
        case "header": {
            if (at.type !== "header") return refused({ why: "onto", lands: "header" });
            const key = at.value;
            const lane = flow.lanes.find((l) => keyEqual(l.key, key));
            return lane === undefined ? GONE : { kind: "set", set: { onto: "header", key, sets: card.sets }, what: { what: "header", lane: laneName(lane) } };
        }
        case "decision": {
            if (at.type !== "decision") return refused({ why: "onto", lands: "decision" });
            const key = at.value;
            const decision = flow.triggers.find((t) => keyEqual(t.key, key));
            return decision === undefined ? GONE : { kind: "set", set: { onto: "decision", key, sets: card.sets }, what: { what: "decision", label: decision.label } };
        }
    }
}

/**
 * The flow a plan leaves: the state it adds in its place, or the card's
 * fields set on what it lands on; a refusal leaves the flow as it was.
 *
 * @param flow - The open flow
 * @param plan - The plan
 * @returns The flow
 */
export function dropFlow(flow: FlowchartFlowValue, plan: FlowchartDropPlan): FlowchartFlowValue {
    switch (plan.kind) {
        case "refused": return flow;
        case "add": return insertState(flow, plan.index, plan.state);
        case "set": {
            const set = plan.set;
            switch (set.onto) {
                case "state": return setState(flow, set.key, set.sets);
                case "transition": return setLink(flow, set.key, set.sets);
                case "header": return setLane(flow, set.key, set.sets);
                case "decision": return setDecision(flow, set.key, set.sets);
            }
        }
    }
}

// ── ⏎ on a card ───────────────────────────────────────────────────────────

/**
 * Where ⏎ on a card drops it (FB34): on the canvas's selection. A state
 * template lands after the selected state, in the lane the canvas draws it
 * in; with a lane selected (#1250), at the end of that lane; with neither, at
 * the end of the first lane. Any other card lands on the selected state,
 * transition, decision or lane when it lands on that — a lane's card on the
 * lane a click on its header selected (#1250). Several states selected are
 * none of these, and a selection the flow no longer holds is none.
 *
 * @param lands - What the card lands on
 * @param selection - What the canvas has selected
 * @param flow - The open flow as its session holds it now
 * @returns Where it drops — the canvas, where the selection takes no such card
 */
export function enterAt(lands: FlowchartLands, selection: FlowchartSelection | null, flow: FlowchartFlowValue | undefined): FlowchartDropAt {
    if (flow === undefined) return ON_CANVAS;
    const picked = (kind: "state" | "link" | "trigger" | "lane"): string | undefined =>
        (selection !== null && selection.kind !== "states" && selection.kind === kind ? selection.key : undefined);
    switch (lands) {
        case "lane": {
            const lanes = drawnLanes(flow);
            const key = picked("state");
            // The selected state as the canvas draws it: the last of its key.
            let at = -1;
            if (key !== undefined) flow.states.forEach((s, i) => { if (keyEqual(s.key, key)) at = i; });
            const state = at < 0 ? undefined : flow.states[at];
            if (state !== undefined) {
                const lane = flow.lanes[lanes.of(state)];
                if (lane === undefined) return ON_CANVAS;
                const row = flow.states.slice(0, at).filter((s) => lanes.of(s) === lanes.of(state)).length + 1;
                return variant("lane", { lane: lane.key, row: BigInt(row) });
            }
            // The selected lane, or else the first: at its end.
            const chosen = picked("lane");
            const target = (chosen === undefined ? undefined : flow.lanes.find((l) => keyEqual(l.key, chosen))) ?? flow.lanes[0];
            if (target === undefined) return ON_CANVAS;
            const li = lanes.lane(target.key);
            return variant("lane", { lane: target.key, row: BigInt(flow.states.filter((s) => lanes.of(s) === li).length) });
        }
        case "state": {
            const key = picked("state");
            return key !== undefined && flow.states.some((s) => keyEqual(s.key, key)) ? variant("state", key) : ON_CANVAS;
        }
        case "transition": {
            const key = picked("link");
            return key !== undefined && flow.links.some((l, i) => keyEqual(linkKeyOf(l, i), key)) ? variant("transition", key) : ON_CANVAS;
        }
        case "decision": {
            const key = picked("trigger");
            return key !== undefined && flow.triggers.some((t) => keyEqual(t.key, key)) ? variant("decision", key) : ON_CANVAS;
        }
        case "header": {
            const key = picked("lane");
            return key !== undefined && flow.lanes.some((l) => keyEqual(l.key, key)) ? variant("header", key) : ON_CANVAS;
        }
    }
}

// ── Its marks ─────────────────────────────────────────────────────────────

/** What the canvas marks while a drag rests where it lands: the lane and the row a state takes, a lane's header, or what a card sets its fields on. */
export type FlowchartDropMark =
    | { readonly kind: "lane"; readonly lane: string; readonly row: number }
    | { readonly kind: "header"; readonly lane: string }
    | { readonly kind: "state" | "transition" | "decision"; readonly key: string };

/**
 * What the canvas marks for a plan: the lane a state lands in and its row,
 * the lane whose header a card sets, or the state, transition or decision a
 * card sets its fields on — nothing for a refusal.
 *
 * @param plan - The plan
 * @returns The mark, or `undefined`
 */
export function markOf(plan: FlowchartDropPlan): FlowchartDropMark | undefined {
    switch (plan.kind) {
        case "refused": return undefined;
        case "add": return { kind: "lane", lane: plan.lane, row: plan.row };
        case "set": return plan.set.onto === "header" ? { kind: "header", lane: plan.set.key } : { kind: plan.set.onto, key: plan.set.key };
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
    if (a.kind === "lane" || b.kind === "lane") return a.kind === "lane" && b.kind === "lane" && keyEqual(a.lane, b.lane) && a.row === b.row;
    if (a.kind === "header" || b.kind === "header") return a.kind === "header" && b.kind === "header" && keyEqual(a.lane, b.lane);
    return a.kind === b.kind && keyEqual(a.key, b.key);
}

// ── Its words ─────────────────────────────────────────────────────────────

/**
 * What the ghost says of a plan (FB30): where a state lands — `after CH* in
 * Sort` — or what a card sets its fields on — `onto CH* → LDD` — or, red, why
 * it can't: `Drop onto a transition`.
 *
 * @param plan - The plan
 * @param m - The flowchart's messages
 * @returns The caption; `undefined` for a refusal that says nothing
 */
export function dropCaption(plan: FlowchartDropPlan, m: FlowchartMessages): string | undefined {
    switch (plan.kind) {
        case "add": return m.dropPlace(plan.place);
        case "set": return m.dropOnto({ what: m.dropWhat(plan.what) });
        case "refused": return plan.why.why === "gone" ? undefined : m.dropRefused(plan.why);
    }
}

/**
 * Why a plan is refused, as the footer says it for a card's ⏎ (FB34).
 *
 * @param plan - The plan
 * @param m - The flowchart's messages
 * @returns The words; `undefined` for a plan that lands, or a refusal that says nothing
 */
export function dropRefusal(plan: FlowchartDropPlan, m: FlowchartMessages): string | undefined {
    return plan.kind === "refused" && plan.why.why !== "gone" ? m.dropRefused(plan.why) : undefined;
}

/**
 * Where a plan lands, as a screen reader hears the drag layer say it — `Sort,
 * after CH*`, `CH* → LDD` — or, refused, the canvas.
 *
 * @param plan - The plan
 * @param m - The flowchart's messages
 * @returns The name
 */
export function dropName(plan: FlowchartDropPlan, m: FlowchartMessages): string {
    switch (plan.kind) {
        case "add": return m.dropPlaceName(plan.place);
        case "set": return m.dropWhat(plan.what);
        case "refused": return m.dropCanvas();
    }
}

/**
 * A drop's name in the history, and its Save's — `Drop Held on Sort, after
 * CH*`.
 *
 * @param plan - The plan: one that lands
 * @param card - The card dropped
 * @param m - The flowchart's messages
 * @returns The name
 */
export function dropLabel(plan: FlowchartDropPlan, card: FlowchartDropCard, m: FlowchartMessages): string {
    return m.dropLabel({ card: card.label, onto: dropName(plan, m) });
}

// ── The canvas's part ─────────────────────────────────────────────────────

/**
 * What the canvas hands the drag layer as its one drop cell (#1249): built by
 * the frame and held still while the flowchart takes drops, its functions
 * reading the open flow as its session holds it. The canvas works out where a
 * drag rests from its own drawing, and marks it.
 */
export interface FlowchartCanvasDrop {
    /** The surface the cell registers on: the flowchart's drop target. */
    readonly surface: string;
    /** What a drag carries, as the flowchart reads it — a card a tab of its library drops — or `undefined`. */
    readonly cardOf: (payload: DragPayload) => FlowchartDropCard | undefined;
    /** What a drop of a card where a drag rests does, over the open flow as it stands. */
    readonly plan: (card: FlowchartDropCard, at: FlowchartDropAt) => FlowchartDropPlan;
    /** The veto: whether the drop a candidate event makes lands. */
    readonly canDrop: DropVeto;
    /** What the ghost says where the drag rests, and that place's name for the announcements. */
    readonly options: Required<Pick<DropCellOptions, "caption" | "name">>;
}
