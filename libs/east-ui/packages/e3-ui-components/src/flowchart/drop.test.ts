/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the flowchart's modules load east-ui-components'
 * entry, which needs one as it loads.
 *
 * What a library card's drop does where it rests (#1249, `Flowchart Builder
 * Spec.md` §9.8, §10, FB30–FB34), decided over real East values and the
 * layout the canvas draws before anything is drawn or written: where a drag
 * rests — the lane and the row a state takes, after the states above the
 * pointer; a state; a transition near its line; a lane's header; a diamond;
 * else the canvas — what each drop does, every refusal in its words, where ⏎
 * on a card drops it, the caption, the announcement's name, the history's
 * label, the marks, and the landing line's geometry. The DOM test
 * (`flowchart-drop.dom.test`) carries them through the drag layer.
 */

import { describe, expect, test } from "vitest";
import { StringType, equalFor, none, some, variant, type ValueTypeOf } from "@elaraai/east";
import { formatters } from "@elaraai/east-ui-components";
import { Flowchart } from "@elaraai/e3-ui/internal";
import {
    DIAMOND_PAD, LINK_PAD, ON_CANVAS, cardOf, dropAtPoint, dropCaption, dropFlow, dropHostOf, dropLabel, dropName, dropRefusal,
    enterAt, markEqual, markOf, planDrop, printDropAt, readDropAt,
    type FlowchartDropAt, type FlowchartDropCard, type FlowchartDropContext, type FlowchartDropPlan,
} from "./drop.js";
import * as edits from "./edits.js";
import { computeLayout, landingSeam, rowCell, type FlowchartLayout } from "./layout.js";
import { flowchartMessages as m, type FlowchartMessages } from "./messages.js";
import { buildModel, type FlowchartModel } from "./model.js";

type Flow = ValueTypeOf<typeof Flowchart.Types.Flow>;

const flowEqual = equalFor(Flowchart.Types.Flow);
const stateEqual = equalFor(Flowchart.Types.State);
const keyEqual = equalFor(StringType);

// ── The flow ──────────────────────────────────────────────────────────────

/** The inbound flow: three lanes holding states and an empty fourth; a decision on SCN → CH*, a keyless CH* → LDD, and SCN's in-place transition. */
const INBOUND: Flow = Flowchart.value({
    lanes: [{ key: "intake", label: "Intake" }, { key: "sort", label: "Sort" }, { key: "load", label: "Load" }, { key: "hold" }],
    states: [
        { key: "ARV", label: "Arrived", lane: "intake" },
        { key: "SCN", label: "Scanned", lane: "intake" },
        { key: "CH*", label: "Sort chutes", lane: "sort", members: 12n },
        { key: "LDD", label: "Loaded", lane: "load" },
    ],
    links: [
        { from: "ARV", to: "SCN" },
        { key: "SCN→CH*", from: "SCN", to: "CH*", trigger: "route" },
        { from: "CH*", to: "LDD" },
        { from: "SCN", to: "SCN", kind: "observed" },
    ],
    triggers: [{ key: "route", label: "route", owner: "sort-planner", queue: ["SCN"] }],
});

/** The flow as the canvas draws it over a canvas 0px wide, as jsdom measures one: lanes 166px wide, rows 96px apart from 56px down. */
function drawn(flow: Flow, orientation: "LR" | "TD" = "LR"): { model: FlowchartModel; layout: FlowchartLayout } {
    const model = buildModel(flow, formatters("en-US"));
    return { model, layout: computeLayout(model, { width: 0, orientation }) };
}

const { model, layout } = drawn(INBOUND);
/** A lane's band, by its key. */
const band = (drawing: FlowchartLayout, key: string) => drawing.lanes.find((l) => keyEqual(l.key, key))!;
/** A transition's route, by the key it goes by. */
const route = (drawing: FlowchartLayout, key: string) => drawing.routes.find((r) => keyEqual(r.key, key))!;
/** A lane's middle, across it. */
const MID = { intake: 83, sort: 249, load: 415, hold: 581 } as const;

// ── The cards ─────────────────────────────────────────────────────────────

type StatePatch = edits.FlowchartStatePatch;
const statePatch = (fields: Partial<StatePatch>): StatePatch => ({ key: none, label: none, lane: none, members: none, notes: none, ...fields });
const linkPatch = (fields: Partial<edits.FlowchartLinkPatch>): edits.FlowchartLinkPatch => ({ key: none, from: none, to: none, kind: none, trigger: none, evidence: none, ...fields });
const lanePatch = (fields: Partial<edits.FlowchartLanePatch>): edits.FlowchartLanePatch => ({ key: none, label: none, ...fields });
const decisionPatch = (fields: Partial<edits.FlowchartDecisionPatch>): edits.FlowchartDecisionPatch => ({ key: none, label: none, letter: none, owner: none, queue: none, outcomes: none, ...fields });

/** The hold step: its key, its label and an empty class, over a state's defaults — and a lane, which the lane it lands in overrides. */
const HELD: FlowchartDropCard = { lands: "lane", label: "Held", sets: statePatch({ key: some("HLD"), label: some(some("Held")), lane: some("load"), members: some(none) }) };
const OBSERVED: FlowchartDropCard = { lands: "transition", label: "Observed", sets: linkPatch({ kind: some(some(variant("observed", null))) }) };
const NOTE: FlowchartDropCard = { lands: "state", label: "Checked", sets: statePatch({ notes: some(some("Checked at the bay")) }) };
const SORTATION: FlowchartDropCard = { lands: "header", label: "Sortation", sets: lanePatch({ label: some(some("Sortation")) }) };
const CUSTOMS: FlowchartDropCard = { lands: "decision", label: "Customs desk", sets: decisionPatch({ owner: some(some("customs-desk")) }) };

/** A flowchart that edits, its session taking a gesture. */
const EDITS: FlowchartDropContext = { flow: INBOUND, edits: true, available: true };

const lane = (key: string, row: number): FlowchartDropAt => variant("lane", { lane: key, row: BigInt(row) });
const at = (kind: "state" | "transition" | "header" | "decision", key: string): FlowchartDropAt => variant(kind, key);
const atText = (a: FlowchartDropAt): string => printDropAt(a);

/** The flow a plan leaves. */
const after = (plan: FlowchartDropPlan, flow: Flow = INBOUND): Flow => dropFlow(flow, plan);

// ============================================================================
// Where a drag rests
// ============================================================================

describe("where a drag rests (FB31–FB33)", () => {
    test("a state card rests on the lane under the pointer, at the row after the states whose middles lie above it — before the first, between two, after the last — its header the lane's start", () => {
        // ARV's middle is 76px down, SCN's 172px.
        expect(atText(dropAtPoint("lane", layout, model, { x: MID.intake, y: 60 }))).toBe(atText(lane("intake", 0)));
        expect(atText(dropAtPoint("lane", layout, model, { x: MID.intake, y: 100 }))).toBe(atText(lane("intake", 1)));
        expect(atText(dropAtPoint("lane", layout, model, { x: MID.intake, y: 172 }))).toBe(atText(lane("intake", 1)));
        expect(atText(dropAtPoint("lane", layout, model, { x: MID.intake, y: 173 }))).toBe(atText(lane("intake", 2)));
        expect(atText(dropAtPoint("lane", layout, model, { x: MID.intake, y: 280 }))).toBe(atText(lane("intake", 2)));
        expect(atText(dropAtPoint("lane", layout, model, { x: 10, y: 20 }))).toBe(atText(lane("intake", 0)));
        // A lane holding no state: its first row, wherever the pointer is.
        expect(atText(dropAtPoint("lane", layout, model, { x: MID.hold, y: 250 }))).toBe(atText(lane("hold", 0)));
        // Past the bands' end, no lane.
        expect(atText(dropAtPoint("lane", layout, model, { x: MID.intake, y: band(layout, "intake").h + 4 }))).toBe(atText(ON_CANVAS));
    });

    test("outside every lane — the + LANE tail — a state card rests on the canvas; a flow with no lane has none to rest on", () => {
        expect(atText(dropAtPoint("lane", layout, model, { x: 700, y: 100 }))).toBe(atText(ON_CANVAS));
        const bare = drawn({ ...INBOUND, lanes: [] });
        expect(atText(dropAtPoint("lane", bare.layout, bare.model, { x: 40, y: 100 }))).toBe(atText(ON_CANVAS));
    });

    test("top down, the lanes are bands across, and the rows run along them", () => {
        const td = drawn(INBOUND, "TD");
        const sort = band(td.layout, "sort");
        const middle = sort.y + sort.h / 2;
        // CH*'s card is the sort band's first, its middle 58px along the row past the rows' start.
        const chutes = td.layout.nodes.get("CH*")!;
        expect(atText(dropAtPoint("lane", td.layout, td.model, { x: chutes.x + 10, y: middle }))).toBe(atText(lane("sort", 0)));
        expect(atText(dropAtPoint("lane", td.layout, td.model, { x: chutes.x + chutes.w - 10, y: middle }))).toBe(atText(lane("sort", 1)));
    });

    test("a transition card rests on the transition whose line runs nearest, within 10px; an in-place transition, folded into its state's ↻, has none", () => {
        const loaded = route(layout, "CH*→LDD#2");
        expect(atText(dropAtPoint("transition", layout, model, loaded.mid))).toBe(atText(at("transition", "CH*→LDD#2")));
        // The run is level: off it across, by the pad and past it.
        expect(atText(dropAtPoint("transition", layout, model, { x: loaded.mid.x, y: loaded.mid.y + LINK_PAD }))).toBe(atText(at("transition", "CH*→LDD#2")));
        expect(atText(dropAtPoint("transition", layout, model, { x: loaded.mid.x, y: loaded.mid.y + LINK_PAD + 2 }))).toBe(atText(ON_CANVAS));
        expect(layout.routes.map((r) => r.key)).not.toContain("SCN→SCN#3");
        const scanned = layout.nodes.get("SCN")!;
        expect(atText(dropAtPoint("transition", layout, model, { x: scanned.cx, y: scanned.cy }))).toBe(atText(ON_CANVAS));
    });

    test("an author's card rests on a state — its card, or as near as the connect gesture's pad — never on an unresolved transition's ghost", () => {
        const arrived = layout.nodes.get("ARV")!;
        expect(atText(dropAtPoint("state", layout, model, { x: arrived.cx, y: arrived.cy }))).toBe(atText(at("state", "ARV")));
        expect(atText(dropAtPoint("state", layout, model, { x: arrived.x + arrived.w + 10, y: arrived.cy }))).toBe(atText(at("state", "ARV")));
        expect(atText(dropAtPoint("state", layout, model, { x: arrived.x + arrived.w + 20, y: arrived.cy }))).toBe(atText(ON_CANVAS));
        const ghosted = drawn({ ...INBOUND, links: [...INBOUND.links, { key: none, from: "LDD", to: "GONE", kind: none, trigger: none, evidence: none }] });
        const ghost = ghosted.layout.nodes.get("GONE")!;
        expect(ghosted.model.nodesByKey.get("GONE")!.ghost).toBe(true);
        expect(atText(dropAtPoint("state", ghosted.layout, ghosted.model, { x: ghost.cx, y: ghost.cy }))).toBe(atText(ON_CANVAS));
    });

    test("an author's card rests on a lane's header — the band before its first row — and on a decision's diamond, within its pad", () => {
        expect(atText(dropAtPoint("header", layout, model, { x: MID.sort, y: 20 }))).toBe(atText(at("header", "sort")));
        expect(atText(dropAtPoint("header", layout, model, { x: MID.sort, y: 60 }))).toBe(atText(ON_CANVAS));
        const routed = route(layout, "SCN→CH*");
        expect(atText(dropAtPoint("decision", layout, model, routed.mid))).toBe(atText(at("decision", "route")));
        expect(atText(dropAtPoint("decision", layout, model, { x: routed.mid.x + DIAMOND_PAD, y: routed.mid.y }))).toBe(atText(at("decision", "route")));
        expect(atText(dropAtPoint("decision", layout, model, { x: routed.mid.x + DIAMOND_PAD + 2, y: routed.mid.y }))).toBe(atText(ON_CANVAS));
    });

    test("where a drag rests rides a drop's CellRef printed, and reads back; another surface's text names nowhere", () => {
        const where = lane("sort", 1);
        expect(atText(readDropAt(printDropAt(where))!)).toBe(atText(where));
        expect(readDropAt("row 3")).toBeUndefined();
    });
});

// ============================================================================
// What a drop does
// ============================================================================

describe("a state card adds a state where it lands (FB31)", () => {
    test("at its row, after the states above it — seeded with its fields over a state's defaults, in the lane it is dropped on, under the card's key", () => {
        const plan = planDrop(HELD, lane("intake", 1), EDITS);
        if (plan.kind !== "add") throw new Error(`expected an add, got ${plan.kind}`);
        expect([plan.lane, plan.row, plan.index, plan.place]).toEqual(["intake", 1, 1, { place: "after", lane: "Intake", after: "ARV" }]);
        expect(stateEqual(plan.state, { key: "HLD", label: some("Held"), lane: "intake", members: none, notes: none })).toBe(true);
        expect(after(plan).states.map((s) => s.key)).toEqual(["ARV", "HLD", "SCN", "CH*", "LDD"]);
        expect(flowEqual(after(plan), edits.insertState(INBOUND, 1, plan.state))).toBe(true);
    });

    test("before a lane's first state, at its start; in a lane holding none; after its last, at the end of the flow's states — where the canvas draws a lane's states", () => {
        const start = planDrop(HELD, lane("sort", 0), EDITS);
        expect(start).toMatchObject({ kind: "add", index: 2, place: { place: "start", lane: "Sort" } });
        expect(after(start).states.map((s) => s.key)).toEqual(["ARV", "SCN", "HLD", "CH*", "LDD"]);
        // A lane with no label is named by its key.
        expect(planDrop(HELD, lane("hold", 0), EDITS)).toMatchObject({ kind: "add", index: 4, place: { place: "in", lane: "hold" } });
        const last = planDrop(HELD, lane("intake", 2), EDITS);
        expect(last).toMatchObject({ kind: "add", row: 2, index: 4, place: { place: "after", after: "SCN" } });
        // A row past the lane's last is its last's.
        expect(planDrop(HELD, lane("intake", 7), EDITS)).toMatchObject({ kind: "add", row: 2, index: 4 });
    });

    test("a state naming no lane the flow has is drawn in the last lane, and a drop there counts it", () => {
        const stray: Flow = { ...INBOUND, states: [...INBOUND.states, { key: "STR", label: none, lane: "gone", members: none, notes: none }] };
        expect(planDrop(HELD, lane("hold", 1), { ...EDITS, flow: stray })).toMatchObject({ kind: "add", row: 1, index: 5, place: { place: "after", after: "STR" } });
    });

    test("its key is the card's where the flow doesn't hold it; made unique where it does — HLD-2, then HLD-3; minted, state-<n>, where the card sets none", () => {
        const once = after(planDrop(HELD, lane("hold", 0), EDITS));
        const twice = planDrop(HELD, lane("hold", 1), { ...EDITS, flow: once });
        expect(twice).toMatchObject({ kind: "add", state: { key: "HLD-2" } });
        const thrice = planDrop(HELD, lane("hold", 2), { ...EDITS, flow: after(twice, once) });
        expect(thrice).toMatchObject({ kind: "add", state: { key: "HLD-3" } });
        // No key, or an empty one: minted past the states' count.
        const bare: FlowchartDropCard = { lands: "lane", label: "Step", sets: statePatch({ label: some(some("Step")) }) };
        expect(planDrop(bare, lane("hold", 0), EDITS)).toMatchObject({ kind: "add", state: { key: "state-5" } });
        const blank: FlowchartDropCard = { lands: "lane", label: "Step", sets: statePatch({ key: some("") }) };
        expect(planDrop(blank, lane("hold", 0), EDITS)).toMatchObject({ kind: "add", state: { key: "state-5" } });
        const taken: Flow = { ...INBOUND, states: [...INBOUND.states, { key: "state-5", label: none, lane: "hold", members: none, notes: none }] };
        expect(planDrop(bare, lane("hold", 1), { ...EDITS, flow: taken })).toMatchObject({ kind: "add", state: { key: "state-6" } });
    });
});

describe("a card sets its fields on what it lands on (FB32, FB33)", () => {
    test("a transition card retypes the transition it lands on — connect, then retype — its key and its ends kept", () => {
        const plan = planDrop(OBSERVED, at("transition", "CH*→LDD#2"), EDITS);
        expect(plan).toMatchObject({ kind: "set", set: { onto: "transition", key: "CH*→LDD#2" }, what: { what: "transition", from: "CH*", to: "LDD" } });
        expect(flowEqual(after(plan), {
            ...INBOUND,
            links: INBOUND.links.map((l, i) => (i === 2 ? { ...l, kind: some(variant("observed", null)) } : l)),
        })).toBe(true);
        // A connection's transition, keyed <from>→<to>, takes it the same way.
        const connected = edits.connect(INBOUND, "LDD", "ARV");
        expect(after(planDrop(OBSERVED, at("transition", connected.key), { ...EDITS, flow: connected.flow }), connected.flow).links[4]!.kind)
            .toEqual(some(variant("observed", null)));
    });

    test("an author's card sets a state's fields, a lane's through its header and a decision's through its diamond", () => {
        expect(flowEqual(after(planDrop(NOTE, at("state", "CH*"), EDITS)),
            { ...INBOUND, states: INBOUND.states.map((s, i) => (i === 2 ? { ...s, notes: some("Checked at the bay") } : s)) })).toBe(true);
        expect(planDrop(SORTATION, at("header", "sort"), EDITS)).toMatchObject({ kind: "set", what: { what: "header", lane: "Sort" } });
        expect(flowEqual(after(planDrop(SORTATION, at("header", "sort"), EDITS)),
            { ...INBOUND, lanes: INBOUND.lanes.map((l, i) => (i === 1 ? { ...l, label: some("Sortation") } : l)) })).toBe(true);
        expect(planDrop(CUSTOMS, at("decision", "route"), EDITS)).toMatchObject({ kind: "set", what: { what: "decision", label: "route" } });
        expect(flowEqual(after(planDrop(CUSTOMS, at("decision", "route"), EDITS)),
            { ...INBOUND, triggers: [{ ...INBOUND.triggers[0]!, owner: some("customs-desk") }] })).toBe(true);
    });

    test("a card that sets a key: a state's follows into its transitions' ends and the decisions' queues (FB18), a lane's moves its states, a decision's renames it on the transitions it governs", () => {
        const rekey: FlowchartDropCard = { lands: "state", label: "Rekey", sets: statePatch({ key: some("SCX") }) };
        expect(flowEqual(after(planDrop(rekey, at("state", "SCN"), EDITS)), edits.editState(INBOUND, "SCN", "SCX", "Scanned"))).toBe(true);
        const relane: FlowchartDropCard = { lands: "header", label: "Rekey", sets: lanePatch({ key: some("sorting") }) };
        expect(flowEqual(after(planDrop(relane, at("header", "sort"), EDITS)), edits.rekeyLane(INBOUND, "sort", "sorting"))).toBe(true);
        const redecide: FlowchartDropCard = { lands: "decision", label: "Rekey", sets: decisionPatch({ key: some("routing") }) };
        const moved = after(planDrop(redecide, at("decision", "route"), EDITS));
        expect([moved.triggers.map((t) => t.key), moved.links.map((l) => l.trigger)]).toEqual([["routing"], [none, some("routing"), none, none]]);
    });
});

describe("a drop is refused, in its words (FB31–FB33)", () => {
    test("anywhere but what its card lands on: Drop onto a lane, a transition, a state, a lane's header, a decision — naming where it lands", () => {
        const cases: [FlowchartDropCard, FlowchartDropAt, string][] = [
            [HELD, ON_CANVAS, "Drop onto a lane"],
            [HELD, at("state", "ARV"), "Drop onto a lane"],
            [OBSERVED, ON_CANVAS, "Drop onto a transition"],
            [OBSERVED, lane("sort", 0), "Drop onto a transition"],
            [NOTE, ON_CANVAS, "Drop onto a state"],
            [SORTATION, ON_CANVAS, "Drop onto a lane's header"],
            [CUSTOMS, at("state", "ARV"), "Drop onto a decision"],
        ];
        for (const [card, where, words] of cases) {
            const plan = planDrop(card, where, EDITS);
            expect(plan.kind, `${card.label} on ${atText(where)}`).toBe("refused");
            expect(dropCaption(plan, m), `${card.label} on ${atText(where)}`).toBe(words);
            expect(dropRefusal(plan, m)).toBe(words);
            expect(flowEqual(after(plan), INBOUND)).toBe(true);
        }
    });

    test("over a flowchart that edits nothing, read only; while its session takes no gesture, not now; with no flow open, none — whatever the card and wherever it rests", () => {
        for (const card of [HELD, OBSERVED, CUSTOMS]) {
            expect(dropCaption(planDrop(card, lane("sort", 0), { ...EDITS, edits: false }), m)).toBe("The flowchart is read only");
            expect(dropCaption(planDrop(card, lane("sort", 0), { ...EDITS, available: false }), m)).toBe("The flow takes no edit now");
            expect(dropCaption(planDrop(card, lane("sort", 0), { ...EDITS, flow: undefined }), m)).toBe("No flow is open");
        }
    });

    test("what it lands on gone from the flow — a stale coordinate — refuses it without words, asking no table for any: a host's that words every refusal alike is asked only where one is refused in words", () => {
        const host: FlowchartMessages = { ...m, dropRefused: () => "Not here" };
        for (const [card, where] of [[HELD, lane("gone", 0)], [OBSERVED, at("transition", "GONE")], [NOTE, at("state", "GONE")], [SORTATION, at("header", "gone")], [CUSTOMS, at("decision", "gone")]] as const) {
            const plan = planDrop(card, where, EDITS);
            expect(plan).toEqual({ kind: "refused", why: { why: "gone" } });
            expect([dropCaption(plan, m), dropRefusal(plan, m)]).toEqual([undefined, undefined]);
            expect([dropCaption(plan, host), dropRefusal(plan, host)]).toEqual([undefined, undefined]);
        }
        const elsewhere = planDrop(HELD, ON_CANVAS, EDITS);
        expect([dropCaption(elsewhere, host), dropRefusal(elsewhere, host)]).toEqual(["Not here", "Not here"]);
    });
});

// ============================================================================
// ⏎ on a card (FB34)
// ============================================================================

describe("⏎ on a card is a drop on the canvas's selection (FB34)", () => {
    test("a state card: after the selected state, in its lane; with no state selected, at the end of the first lane", () => {
        expect(atText(enterAt("lane", { kind: "state", key: "ARV" }, INBOUND))).toBe(atText(lane("intake", 1)));
        expect(atText(enterAt("lane", { kind: "state", key: "SCN" }, INBOUND))).toBe(atText(lane("intake", 2)));
        expect(atText(enterAt("lane", { kind: "state", key: "CH*" }, INBOUND))).toBe(atText(lane("sort", 1)));
        for (const selection of [null, { kind: "link", key: "CH*→LDD#2" }, { kind: "state", key: "GONE" }] as const) {
            expect(atText(enterAt("lane", selection, INBOUND))).toBe(atText(lane("intake", 2)));
        }
        // A state naming no lane the flow has is drawn in the last: after it there.
        const stray: Flow = { ...INBOUND, states: [...INBOUND.states, { key: "STR", label: none, lane: "gone", members: none, notes: none }] };
        expect(atText(enterAt("lane", { kind: "state", key: "STR" }, stray))).toBe(atText(lane("hold", 1)));
        // No lane, or no flow: nowhere.
        expect(atText(enterAt("lane", null, { ...INBOUND, lanes: [] }))).toBe(atText(ON_CANVAS));
        expect(atText(enterAt("lane", null, undefined))).toBe(atText(ON_CANVAS));
    });

    test("any other card on the selected state, transition or decision when that is what it lands on; a lane's card on no selection the canvas makes", () => {
        expect(atText(enterAt("transition", { kind: "link", key: "CH*→LDD#2" }, INBOUND))).toBe(atText(at("transition", "CH*→LDD#2")));
        expect(atText(enterAt("transition", { kind: "state", key: "CH*" }, INBOUND))).toBe(atText(ON_CANVAS));
        expect(atText(enterAt("transition", { kind: "link", key: "GONE" }, INBOUND))).toBe(atText(ON_CANVAS));
        expect(atText(enterAt("state", { kind: "state", key: "CH*" }, INBOUND))).toBe(atText(at("state", "CH*")));
        expect(atText(enterAt("state", null, INBOUND))).toBe(atText(ON_CANVAS));
        expect(atText(enterAt("decision", { kind: "trigger", key: "route" }, INBOUND))).toBe(atText(at("decision", "route")));
        expect(atText(enterAt("decision", { kind: "link", key: "SCN→CH*" }, INBOUND))).toBe(atText(ON_CANVAS));
        expect(atText(enterAt("header", { kind: "state", key: "CH*" }, INBOUND))).toBe(atText(ON_CANVAS));
        // An in-place transition has no line to drop on: its ↻ badge selects it, by the key the model gives it, and ⏎ retypes it.
        const inPlace = model.nodesByKey.get("SCN")!.inPlaceKeys[0]!;
        const planned: FlowchartDropCard = { lands: "transition", label: "Planned", sets: linkPatch({ kind: some(some(variant("planned", null))) }) };
        expect(atText(enterAt("transition", { kind: "link", key: inPlace }, INBOUND))).toBe(atText(at("transition", inPlace)));
        expect(after(planDrop(planned, enterAt("transition", { kind: "link", key: inPlace }, INBOUND), EDITS)).links[3]!.kind).toEqual(some(variant("planned", null)));
        // Where it would be refused, the footer says why: the drop's own words.
        expect(dropRefusal(planDrop(OBSERVED, enterAt("transition", { kind: "state", key: "CH*" }, INBOUND), EDITS), m)).toBe("Drop onto a transition");
    });
});

// ============================================================================
// Its words, its marks, and where the canvas draws them
// ============================================================================

describe("its words and its marks (FB30)", () => {
    test("the ghost says where a state lands, or what a card sets its fields on; the drag layer names the place; the history labels the drop", () => {
        const between = planDrop(HELD, lane("intake", 1), EDITS);
        expect([dropCaption(between, m), dropName(between, m), dropLabel(between, HELD, m)])
            .toEqual(["after ARV in Intake", "Intake, after ARV", "Drop Held on Intake, after ARV"]);
        const first = planDrop(HELD, lane("sort", 0), EDITS);
        expect([dropCaption(first, m), dropName(first, m)]).toEqual(["at the start of Sort", "the start of Sort"]);
        const empty = planDrop(HELD, lane("hold", 0), EDITS);
        expect([dropCaption(empty, m), dropName(empty, m)]).toEqual(["in hold", "hold"]);
        const retype = planDrop(OBSERVED, at("transition", "CH*→LDD#2"), EDITS);
        expect([dropCaption(retype, m), dropName(retype, m), dropLabel(retype, OBSERVED, m)])
            .toEqual(["onto CH* → LDD", "CH* → LDD", "Drop Observed on CH* → LDD"]);
        expect(dropCaption(planDrop(NOTE, at("state", "CH*"), EDITS), m)).toBe("onto CH*");
        expect(dropCaption(planDrop(SORTATION, at("header", "sort"), EDITS), m)).toBe("onto lane Sort");
        expect(dropCaption(planDrop(CUSTOMS, at("decision", "route"), EDITS), m)).toBe("onto decision route");
        expect(dropName(planDrop(OBSERVED, ON_CANVAS, EDITS), m)).toBe("the canvas");
        expect(dropRefusal(between, m)).toBeUndefined();
    });

    test("the canvas marks the lane and the row a state lands in, a lane whose header a card sets, or what a card sets its fields on — nothing where a drop is refused", () => {
        expect(markOf(planDrop(HELD, lane("intake", 1), EDITS))).toEqual({ kind: "lane", lane: "intake", row: 1 });
        expect(markOf(planDrop(SORTATION, at("header", "sort"), EDITS))).toEqual({ kind: "header", lane: "sort" });
        expect(markOf(planDrop(OBSERVED, at("transition", "CH*→LDD#2"), EDITS))).toEqual({ kind: "transition", key: "CH*→LDD#2" });
        expect(markOf(planDrop(NOTE, at("state", "ARV"), EDITS))).toEqual({ kind: "state", key: "ARV" });
        expect(markOf(planDrop(CUSTOMS, at("decision", "route"), EDITS))).toEqual({ kind: "decision", key: "route" });
        expect(markOf(planDrop(OBSERVED, ON_CANVAS, EDITS))).toBeUndefined();
        // One mark is another only where it marks the same place.
        expect(markEqual({ kind: "lane", lane: "sort", row: 1 }, { kind: "lane", lane: "sort", row: 1 })).toBe(true);
        expect(markEqual({ kind: "lane", lane: "sort", row: 1 }, { kind: "lane", lane: "sort", row: 2 })).toBe(false);
        expect(markEqual({ kind: "header", lane: "sort" }, { kind: "lane", lane: "sort", row: 0 })).toBe(false);
        expect(markEqual({ kind: "state", key: "ARV" }, { kind: "transition", key: "ARV" })).toBe(false);
        expect(markEqual({ kind: "state", key: "ARV" }, { kind: "state", key: "ARV" })).toBe(true);
        expect(markEqual(undefined, undefined)).toBe(true);
        expect(markEqual({ kind: "state", key: "ARV" }, undefined)).toBe(false);
    });

    test("the landing line runs across a node's footprint, centred on the gap before its row: the 16px under the header before the first, half the gap between two rows before another — upright, top down", () => {
        const intake = band(layout, "intake");
        expect(rowCell(layout, intake, 1)).toEqual({ x: 25, y: 152, w: 116, h: 40 });
        expect(landingSeam(layout, intake, 0)).toEqual({ x: 25, y: 48, w: 116, h: 0 });
        expect(landingSeam(layout, intake, 1)).toEqual({ x: 25, y: 124, w: 116, h: 0 });
        expect(landingSeam(layout, intake, 2)).toEqual({ x: 25, y: 220, w: 116, h: 0 });
        const td = drawn(INBOUND, "TD");
        const sort = band(td.layout, "sort");
        const chutes = td.layout.nodes.get("CH*")!;
        expect(rowCell(td.layout, sort, 0)).toEqual({ x: chutes.x, y: chutes.y, w: chutes.w, h: chutes.h });
        expect(landingSeam(td.layout, sort, 0)).toEqual({ x: chutes.x - 8, y: chutes.y, w: 0, h: 40 });
        expect(landingSeam(td.layout, sort, 1)).toEqual({ x: chutes.x + td.layout.rows.pitch - (td.layout.rows.pitch - 116) / 2, y: chutes.y, w: 0, h: 40 });
    });
});

// ============================================================================
// What the canvas takes
// ============================================================================

describe("what the canvas takes dropped", () => {
    test("each tab whose cards drop, under the library its cards drag from: the templates', and an author's tab by what its drop's type names — never the Flows tab, nor an author's tab without a drop", () => {
        const host = dropHostOf("flowchart.surface", [
            ["lib:flows", variant("flows", null)],
            ["lib:states", variant("states", { name: none, icon: none, cards: [{ key: "HLD", label: "Held", meta: none, group: none, sets: HELD.sets }] })],
            ["lib:transitions", variant("transitions", { name: none, icon: none, cards: [{ key: "obs", label: "Observed", meta: none, group: none, sets: OBSERVED.sets }] })],
            ["lib:tab:Notes", variant("tab", { name: "Notes", icon: none, lands: variant("state", [{ key: "n", label: "Checked", meta: none, group: none, sets: NOTE.sets }]) })],
            ["lib:tab:Lanes", variant("tab", { name: "Lanes", icon: none, lands: variant("lane", [{ key: "s", label: "Sortation", meta: none, group: none, sets: SORTATION.sets }]) })],
            ["lib:tab:Owners", variant("tab", { name: "Owners", icon: none, lands: variant("decision", [{ key: "c", label: "Customs desk", meta: none, group: none, sets: CUSTOMS.sets }]) })],
            ["lib:tab:Moves", variant("tab", { name: "Moves", icon: none, lands: variant("transition", [{ key: "m", label: "Observed", meta: none, group: none, sets: OBSERVED.sets }]) })],
            ["lib:tab:Desks", variant("tab", { name: "Desks", icon: none, lands: variant("none", [{ key: "d", label: "Hold bay", meta: none, group: none }]) })],
        ]);
        expect(host.surface).toBe("flowchart.surface");
        expect([...host.libraries.keys()]).toEqual(["lib:states", "lib:transitions", "lib:tab:Notes", "lib:tab:Lanes", "lib:tab:Owners", "lib:tab:Moves"]);
        expect(["lib:states", "lib:transitions", "lib:tab:Notes", "lib:tab:Lanes", "lib:tab:Owners", "lib:tab:Moves"]
            .map((id) => { const [card] = [...host.libraries.get(id)!.values()]; return [card!.lands, card!.label]; }))
            .toEqual([["lane", "Held"], ["transition", "Observed"], ["state", "Checked"], ["header", "Sortation"], ["decision", "Customs desk"], ["transition", "Observed"]]);
        expect(cardOf(host, "lib:states", "HLD")?.label).toBe("Held");
        expect([cardOf(host, "lib:states", "GONE"), cardOf(host, "lib:tab:Desks", "d"), cardOf(host, "lib:flows", "x")]).toEqual([undefined, undefined, undefined]);
    });
});
