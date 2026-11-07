/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * No DOM is under test: the flowchart's modules load east-ui-components'
 * entry, which needs one as it loads.
 */

/**
 * The Flowchart's drops (#1501, `Flowchart Records Spec.md` R14, D5, D8),
 * pure, over rows as the read holds them: where a drag rests over the drawing
 * for each kind of card — a lane and the row a state takes, a transition's
 * line, a state, a lane's header, the gap between two lanes, a decision's
 * diamond, or the canvas — and never a ghost, *No lane* or a row drawn as
 * context; what a drop there does, as a plan and as the edits it writes; why
 * one is refused, in its words or — what it lands on gone — in none — a kind
 * whose keys can't be typed, and a lane whose key is still to be typed, among
 * them (#1549); ⏎ on a
 * card; its words and its marks; and what the canvas takes dropped from the
 * tabs the payload lists.
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import { DateTimeType, StringType, equalFor, none, printFor, some, toEastTypeValue, variant } from "@elaraai/east";
import { FlowchartLibraryTabType } from "@elaraai/e3-ui/internal";
import {
    DIAMOND_PAD, LINK_PAD, ON_CANVAS, cardOf, cardSort, dropAtPoint, dropCaption, dropEdits, dropHostOf, dropLabel, dropName, dropRefusal,
    droppedSelection, enterAt, gapLine, landsOf, markEqual, markOf, planDrop, printDropAt, readDropAt,
    type FlowchartDropAt, type FlowchartDropCard, type FlowchartDropContext, type FlowchartDropPlan,
} from "./drop.js";
import { computeLayout, landingSeam, rowCell, type FlowchartLayout, type LaneBand, type LinkRoute, type NodeRect } from "./layout.js";
import type { FlowchartMessages } from "./messages.js";
import { kindKeys } from "../shared/schedule/kind-keys.js";
import { ALL_LANE_KEY, NO_LANE_KEY, STRING_KIND_KEYS, type FlowchartModel, type FlowchartRow, type FlowchartRows } from "./model.js";
import type { FlowchartSort } from "./read.js";
import { bytes, decisionRow, holdingOf, laneRow, lines, modelOf, optionBytes, rowsOf, stateRow, transitionRow, w, words } from "./rows.test-utils.js";

const m = words.m;
const keyEqual = equalFor(StringType);

/** Where a drag rests, printed through East: what a test compares. */
const text = printDropAt;

/** An author's card's writes, printed through East — their type the author's tab's on the wire. */
const writes = printFor(FlowchartLibraryTabType.cases.tab.fields.cards.value.fields.sets);

/** A card's values, as a drop hands them over. */
const CARD = new Uint8Array([1, 2, 3]);

/** An author's card: the fields its patch sets on a row of a kind. */
type SetCard = Extract<FlowchartDropCard, { readonly does: "set" }>;

const HELD: FlowchartDropCard = { does: "addState", label: "Held", values: CARD };
const OBSERVED: FlowchartDropCard = { does: "retype", label: "Observed", values: CARD };
const DOCK: FlowchartDropCard = { does: "addLane", label: "Dock", values: CARD };
const NOTE: SetCard = { does: "set", sort: "states", label: "Checked", sets: [{ path: ["notes"], value: CARD }] };
const TAGGED: SetCard = { does: "set", sort: "transitions", label: "Tagged", sets: [{ path: ["evidence"], value: CARD }] };
const SORTATION: SetCard = { does: "set", sort: "lanes", label: "Sortation", sets: [{ path: ["label"], value: CARD }] };
const CUSTOMS: SetCard = { does: "set", sort: "decisions", label: "Customs desk", sets: [{ path: ["owner"], value: CARD }] };

/**
 * The depot: Intake holding ARV then SCN, Sort holding CH*, Load holding LDD,
 * and an empty Hold; ARV → SCN, SCN → CH* under the decision route, CH* →
 * LDD observed, and SCN in place.
 */
const DEPOT = rowsOf({
    lanes: [laneRow("intake", "Intake", 1), laneRow("sort", "Sort", 2), laneRow("load", "Load", 3), laneRow("hold", "Hold", 4)],
    states: [
        stateRow("ARV", "Arrived", { lane: "intake", order: 1 }),
        stateRow("SCN", "Scanned", { lane: "intake", order: 2 }),
        stateRow("CH*", "Sort chutes", { lane: "sort", order: 1 }),
        stateRow("LDD", "Loaded", { lane: "load", order: 1 }),
    ],
    transitions: [
        transitionRow("t1", "ARV", "SCN"),
        transitionRow("t2", "SCN", "CH*", { decision: "route" }),
        transitionRow("t3", "CH*", "LDD", { kind: "observed" }),
        transitionRow("t4", "SCN", "SCN"),
    ],
    decisions: [decisionRow("route", "route")],
});

/** A state no lane is named for: drawn in *No lane*. */
const LOOSE = stateRow("LOOSE", "Loose");

/**
 * Rows with some drawn as context, as the narrowing draws them.
 *
 * @param rows - The rows
 * @param keys - The keys drawn as context
 * @returns The rows, those keys dimmed
 */
function dimmed<R>(rows: readonly FlowchartRow<R>[], keys: readonly string[]): FlowchartRow<R>[] {
    const context = new Set(keys);
    return rows.map((row) => (context.has(row.key) ? { ...row, dimmed: true } : row));
}

/** The depot as the narrowing draws it: CH*, and CH* → LDD, as context; LOOSE in No lane; LDD → GONE ending at a ghost. */
const NARROWED = rowsOf({
    ...DEPOT,
    states: [...dimmed(DEPOT.states, ["CH*"]), LOOSE],
    transitions: [...dimmed(DEPOT.transitions, ["t3"]), transitionRow("t5", "LDD", "GONE")],
});

/**
 * What the canvas draws of rows, laid out as wide as its lanes need.
 *
 * @param rows - The rows
 * @param orientation - Left to right, or top down
 * @returns The model and its layout
 */
function drawn(rows: FlowchartRows, orientation: "LR" | "TD" = "LR"): { readonly model: FlowchartModel; readonly layout: FlowchartLayout } {
    const model = modelOf(rows);
    return { model, layout: computeLayout(model, { width: 0, orientation }) };
}

const { model, layout } = drawn(DEPOT);

const KIND_NAMES: { readonly [S in FlowchartSort]: string } = { states: "state", transitions: "transition", lanes: "lane", decisions: "decision" };

/**
 * What a drop reads: every kind edited, taking an edit now and adding rows — unless given.
 *
 * @param over - What the Flowchart draws
 * @param more - What differs
 * @returns The drop's context
 */
function ctx(over: FlowchartModel = model, more: Partial<FlowchartDropContext> = {}): FlowchartDropContext {
    return { model: over, editable: () => true, available: () => true, kindName: (sort) => KIND_NAMES[sort], untyped: () => undefined, ...more };
}

/** A band and the row a new state takes in it. */
const lane = (key: string, row: number): FlowchartDropAt => variant("lane", { lane: key, row: BigInt(row) });

/** The gap a new lane lands in. */
const gap = (at: number): FlowchartDropAt => variant("gap", BigInt(at));

/**
 * A row a card lands on, by its key.
 *
 * @param kind - What it is
 * @param key - Its key
 * @returns Where the drag rests
 */
function at(kind: "state" | "transition" | "header" | "decision", key: string): FlowchartDropAt {
    switch (kind) {
        case "state": return variant("state", key);
        case "transition": return variant("transition", key);
        case "header": return variant("header", key);
        case "decision": return variant("decision", key);
    }
}

/**
 * A layout's band, by its lane's key.
 *
 * @param drawing - The layout
 * @param key - The lane's key
 * @returns The band
 */
function bandOf(drawing: FlowchartLayout, key: string): LaneBand {
    const band = drawing.lanes.find((l) => keyEqual(l.key, key));
    if (band === undefined) throw new Error(`No band ${key}`);
    return band;
}

/**
 * A layout's line for a transition, by its key.
 *
 * @param drawing - The layout
 * @param key - The transition's key
 * @returns Its route
 */
function routeOf(drawing: FlowchartLayout, key: string): LinkRoute {
    const route = drawing.routes.find((r) => keyEqual(r.key, key));
    if (route === undefined) throw new Error(`No line for ${key}`);
    return route;
}

/** The depot's card for a state. */
const node = (key: string): NodeRect => layout.nodes.get(key)!;

/** The middle of a lane of the depot's, across. */
const mid = (key: string): number => { const band = bandOf(layout, key); return band.x + band.w / 2; };

/**
 * A plan as a test reads it: what it does, where, and in what words — a
 * card's values and writes printed through East.
 *
 * @param plan - The plan
 * @returns What the test compares
 */
function planned(plan: FlowchartDropPlan) {
    switch (plan.kind) {
        case "addState": return { kind: plan.kind, band: plan.band, row: plan.row, values: bytes(plan.values), place: plan.place };
        case "retype": return { kind: plan.kind, key: plan.key, values: bytes(plan.values), what: plan.what };
        case "addLane": return { kind: plan.kind, at: plan.at, values: bytes(plan.values), place: plan.place };
        case "set": return { kind: plan.kind, sort: plan.sort, key: plan.key, sets: writes(plan.sets), what: plan.what };
        case "refused": return { kind: plan.kind, why: plan.why };
    }
}

// ============================================================================
// Where a drag rests
// ============================================================================

describe("where a drag rests", () => {
    test("a state's card rests on the lane under the pointer, at the row after the states whose middles lie above it — before the first, between two, after the last; in a lane holding none, its first row; past the bands' end, the canvas", () => {
        const x = mid("intake");
        expect(text(dropAtPoint("lane", layout, model, { x, y: node("ARV").cy - 16 }))).toBe(text(lane("intake", 0)));
        expect(text(dropAtPoint("lane", layout, model, { x, y: node("ARV").cy + 24 }))).toBe(text(lane("intake", 1)));
        expect(text(dropAtPoint("lane", layout, model, { x, y: node("SCN").cy }))).toBe(text(lane("intake", 1)));
        expect(text(dropAtPoint("lane", layout, model, { x, y: node("SCN").cy + 1 }))).toBe(text(lane("intake", 2)));
        expect(text(dropAtPoint("lane", layout, model, { x, y: node("SCN").cy + 108 }))).toBe(text(lane("intake", 2)));
        expect(text(dropAtPoint("lane", layout, model, { x: 10, y: 20 }))).toBe(text(lane("intake", 0)));
        expect(text(dropAtPoint("lane", layout, model, { x: mid("hold"), y: 250 }))).toBe(text(lane("hold", 0)));
        expect(text(dropAtPoint("lane", layout, model, { x, y: bandOf(layout, "intake").h + 4 }))).toBe(text(ON_CANVAS));
    });

    test("outside every lane — the + LANE tail — and over No lane, a state's card rests on the canvas; a Flowchart given no lanes takes it in its one band", () => {
        expect(text(dropAtPoint("lane", layout, model, { x: layout.laneTail.x + 10, y: 100 }))).toBe(text(ON_CANVAS));
        const loose = drawn({ ...DEPOT, states: [...DEPOT.states, LOOSE] });
        const noLane = bandOf(loose.layout, NO_LANE_KEY);
        expect(text(dropAtPoint("lane", loose.layout, loose.model, { x: noLane.x + noLane.w / 2, y: 100 }))).toBe(text(ON_CANVAS));
        const bare = drawn(rowsOf({ states: [stateRow("A", "A", { order: 1 }), stateRow("B", "B", { order: 2 })] }));
        const all = bandOf(bare.layout, ALL_LANE_KEY);
        expect(text(dropAtPoint("lane", bare.layout, bare.model, { x: all.x + all.w / 2, y: bare.layout.nodes.get("A")!.cy + 1 }))).toBe(text(lane(ALL_LANE_KEY, 1)));
    });

    test("top down, the lanes are bands across, and the rows lie along them", () => {
        const td = drawn(DEPOT, "TD");
        const sort = bandOf(td.layout, "sort");
        const middle = sort.y + sort.h / 2;
        const chutes = td.layout.nodes.get("CH*")!;
        expect(text(dropAtPoint("lane", td.layout, td.model, { x: chutes.x + 10, y: middle }))).toBe(text(lane("sort", 0)));
        expect(text(dropAtPoint("lane", td.layout, td.model, { x: chutes.x + chutes.w - 10, y: middle }))).toBe(text(lane("sort", 1)));
    });

    test("a transition's card rests on the transition whose line lies nearest, within 10px; an in-place transition, folded into its state's ↻, has none", () => {
        const loaded = routeOf(layout, "t3");
        expect(text(dropAtPoint("transition", layout, model, loaded.mid))).toBe(text(at("transition", "t3")));
        expect(text(dropAtPoint("transition", layout, model, { x: loaded.mid.x, y: loaded.mid.y + LINK_PAD }))).toBe(text(at("transition", "t3")));
        expect(text(dropAtPoint("transition", layout, model, { x: loaded.mid.x, y: loaded.mid.y + LINK_PAD + 2 }))).toBe(text(ON_CANVAS));
        expect(model.nodesByKey.get("SCN")!.inPlaceKeys).toEqual(["t4"]);
        expect(layout.routes.map((r) => r.key)).not.toContain("t4");
        expect(text(dropAtPoint("transition", layout, model, { x: node("SCN").cx, y: node("SCN").cy }))).toBe(text(ON_CANVAS));
    });

    test("an author's card rests on a state — its card, or as near as the connect gesture's pad — never on a ghost", () => {
        const arrived = node("ARV");
        expect(text(dropAtPoint("state", layout, model, { x: arrived.cx, y: arrived.cy }))).toBe(text(at("state", "ARV")));
        expect(text(dropAtPoint("state", layout, model, { x: arrived.x + arrived.w + 10, y: arrived.cy }))).toBe(text(at("state", "ARV")));
        expect(text(dropAtPoint("state", layout, model, { x: arrived.x + arrived.w + 20, y: arrived.cy }))).toBe(text(ON_CANVAS));
        const narrowed = drawn(NARROWED);
        const ghost = narrowed.layout.nodes.get("GONE")!;
        expect(narrowed.model.nodesByKey.get("GONE")!.ghost).toBe(true);
        expect(text(dropAtPoint("state", narrowed.layout, narrowed.model, { x: ghost.cx, y: ghost.cy }))).toBe(text(ON_CANVAS));
    });

    test("an author's card rests on a lane's header — the band before its first row — and on a decision's diamond, within its pad; No lane has no header", () => {
        expect(text(dropAtPoint("header", layout, model, { x: mid("sort"), y: 20 }))).toBe(text(at("header", "sort")));
        expect(text(dropAtPoint("header", layout, model, { x: mid("sort"), y: layout.rows[0]!.start + 4 }))).toBe(text(ON_CANVAS));
        const routed = routeOf(layout, "t2");
        expect(text(dropAtPoint("decision", layout, model, routed.mid))).toBe(text(at("decision", "route")));
        expect(text(dropAtPoint("decision", layout, model, { x: routed.mid.x + DIAMOND_PAD, y: routed.mid.y }))).toBe(text(at("decision", "route")));
        expect(text(dropAtPoint("decision", layout, model, { x: routed.mid.x + DIAMOND_PAD + 2, y: routed.mid.y }))).toBe(text(ON_CANVAS));
        const narrowed = drawn(NARROWED);
        const noLane = bandOf(narrowed.layout, NO_LANE_KEY);
        expect(text(dropAtPoint("header", narrowed.layout, narrowed.model, { x: noLane.x + noLane.w / 2, y: 20 }))).toBe(text(ON_CANVAS));
    });

    test("a row the narrowing draws as context takes no card — its state, its transition's line — yet keeps its row", () => {
        const narrowed = drawn(NARROWED);
        const chutes = narrowed.layout.nodes.get("CH*")!;
        expect(text(dropAtPoint("state", narrowed.layout, narrowed.model, { x: chutes.cx, y: chutes.cy }))).toBe(text(ON_CANVAS));
        expect(text(dropAtPoint("transition", narrowed.layout, narrowed.model, routeOf(narrowed.layout, "t3").mid))).toBe(text(ON_CANVAS));
        expect(text(dropAtPoint("lane", narrowed.layout, narrowed.model, { x: chutes.cx, y: chutes.cy + 1 }))).toBe(text(lane("sort", 1)));
    });

    test("a lane's card rests in the gap before the first lane whose middle lies past the pointer — past the last, the band row's tail; a Flowchart given no lanes has none", () => {
        expect(text(dropAtPoint("gap", layout, model, { x: 10, y: 100 }))).toBe(text(gap(0)));
        expect(text(dropAtPoint("gap", layout, model, { x: mid("intake") + 1, y: 100 }))).toBe(text(gap(1)));
        expect(text(dropAtPoint("gap", layout, model, { x: mid("load") - 1, y: 100 }))).toBe(text(gap(2)));
        expect(text(dropAtPoint("gap", layout, model, { x: mid("hold") + 1, y: 100 }))).toBe(text(gap(4)));
        expect(text(dropAtPoint("gap", layout, model, { x: layout.laneTail.x + 10, y: 100 }))).toBe(text(gap(4)));
        const td = drawn(DEPOT, "TD");
        const sort = bandOf(td.layout, "sort");
        expect(text(dropAtPoint("gap", td.layout, td.model, { x: 10, y: sort.y + sort.h / 2 + 1 }))).toBe(text(gap(2)));
        const bare = drawn(rowsOf({ states: [stateRow("A", "A")] }));
        expect(text(dropAtPoint("gap", bare.layout, bare.model, { x: 10, y: 100 }))).toBe(text(ON_CANVAS));
    });

    test("where a drag rests rides a drop's CellRef printed, and reads back; another surface's text names nowhere", () => {
        for (const where of [lane("sort", 1), at("state", "CH*"), at("transition", "t3"), at("header", "sort"), gap(2), at("decision", "route"), ON_CANVAS]) {
            expect(text(readDropAt(printDropAt(where))!)).toBe(text(where));
        }
        expect(readDropAt("row 3")).toBeUndefined();
    });
});

// ============================================================================
// What a drop does
// ============================================================================

describe("a state's card adds a state where it lands", () => {
    test("in the lane it lands on, at its row: after the state above it, at the start of a lane holding states, in a lane holding none — a row past the lane's last, its last's", () => {
        expect(planned(planDrop(HELD, lane("intake", 1), ctx())))
            .toEqual({ kind: "addState", band: "intake", row: 1, values: bytes(CARD), place: { place: "after", lane: "Intake", after: "ARV" } });
        expect(planned(planDrop(HELD, lane("sort", 0), ctx()))).toEqual({ kind: "addState", band: "sort", row: 0, values: bytes(CARD), place: { place: "start", lane: "Sort" } });
        expect(planned(planDrop(HELD, lane("hold", 0), ctx()))).toEqual({ kind: "addState", band: "hold", row: 0, values: bytes(CARD), place: { place: "in", lane: "Hold" } });
        expect(planned(planDrop(HELD, lane("intake", 7), ctx()))).toMatchObject({ row: 2, place: { place: "after", lane: "Intake", after: "SCN" } });
    });

    test("one state from the card's values — keyed state-<n>, made unique — its lane the one it lands in, its order between the states it lands between; the drop selects it", () => {
        const plan = planDrop(HELD, lane("intake", 1), ctx());
        const made = dropEdits(plan, holdingOf(DEPOT));
        expect(lines(made)).toEqual({ edits: [`createState state-5 ${w.state(undefined, "intake", 1.5)} ${optionBytes(some(CARD))}`], key: "state-5" });
        expect(droppedSelection(plan, made!)).toEqual({ kind: "state", key: "state-5" });
        // At a lane's start, one before its first; in a lane holding none, 1; after its last, one past it.
        expect(lines(dropEdits(planDrop(HELD, lane("sort", 0), ctx()), holdingOf(DEPOT)))?.edits).toEqual([`createState state-5 ${w.state(undefined, "sort", 0)} ${optionBytes(some(CARD))}`]);
        expect(lines(dropEdits(planDrop(HELD, lane("hold", 0), ctx()), holdingOf(DEPOT)))?.edits).toEqual([`createState state-5 ${w.state(undefined, "hold", 1)} ${optionBytes(some(CARD))}`]);
        expect(lines(dropEdits(planDrop(HELD, lane("intake", 2), ctx()), holdingOf(DEPOT)))?.edits).toEqual([`createState state-5 ${w.state(undefined, "intake", 3)} ${optionBytes(some(CARD))}`]);
        // state-5 held already — a row the rail hides, say — the next.
        const taken = new Set(["state-5"]);
        expect(lines(dropEdits(plan, holdingOf(DEPOT, { taken: (sort, key) => sort === "states" && taken.has(key) })))?.key).toBe("state-6");
    });

    test("a Flowchart given no lanes takes it in its one band, naming no lane", () => {
        const bare = rowsOf({ states: [stateRow("A", "A", { order: 1 }), stateRow("B", "B", { order: 2 })] });
        const plan = planDrop(HELD, lane(ALL_LANE_KEY, 1), ctx(modelOf(bare)));
        expect(planned(plan)).toEqual({ kind: "addState", band: ALL_LANE_KEY, row: 1, values: bytes(CARD), place: { place: "after", lane: undefined, after: "A" } });
        expect(lines(dropEdits(plan, holdingOf(bare)))?.edits).toEqual([`createState state-3 ${w.state(undefined, undefined, 1.5)} ${optionBytes(some(CARD))}`]);
    });
});

describe("a transition's card gives the transition it lands on its values", () => {
    test("its key and its ends kept — an in-place transition's too, by its key — and the drop selects nothing new", () => {
        const plan = planDrop(OBSERVED, at("transition", "t3"), ctx());
        expect(planned(plan)).toEqual({ kind: "retype", key: "t3", values: bytes(CARD), what: { what: "transition", from: "CH*", to: "LDD" } });
        const made = dropEdits(plan, holdingOf(DEPOT));
        expect(lines(made)).toEqual({ edits: [`retypeTransition t3 ${bytes(CARD)}`], key: undefined });
        expect(droppedSelection(plan, made!)).toBeUndefined();
        expect(planned(planDrop(OBSERVED, at("transition", "t4"), ctx()))).toMatchObject({ kind: "retype", key: "t4", what: { what: "transition", from: "SCN", to: "SCN" } });
    });
});

describe("a lane's card adds a lane where it lands among the lanes", () => {
    test("before the lane it lands before, or at the end of the lanes — keyed lane-<n>, its order between its neighbours'; the drop selects it", () => {
        const plan = planDrop(DOCK, gap(1), ctx());
        expect(planned(plan)).toEqual({ kind: "addLane", at: 1, values: bytes(CARD), place: { place: "before", lane: "Sort" } });
        const made = dropEdits(plan, holdingOf(DEPOT));
        expect(lines(made)).toEqual({ edits: [`createLane lane-5 ${w.lane(undefined, 1.5)} ${optionBytes(some(CARD))}`], key: "lane-5" });
        expect(droppedSelection(plan, made!)).toEqual({ kind: "lane", key: "lane-5" });
        expect(planned(planDrop(DOCK, gap(4), ctx()))).toMatchObject({ at: 4, place: { place: "end" } });
        expect(planned(planDrop(DOCK, gap(9), ctx()))).toMatchObject({ at: 4, place: { place: "end" } });
        expect(lines(dropEdits(planDrop(DOCK, gap(0), ctx()), holdingOf(DEPOT)))?.edits).toEqual([`createLane lane-5 ${w.lane(undefined, 0)} ${optionBytes(some(CARD))}`]);
        expect(lines(dropEdits(planDrop(DOCK, gap(4), ctx()), holdingOf(DEPOT)))?.edits).toEqual([`createLane lane-5 ${w.lane(undefined, 5)} ${optionBytes(some(CARD))}`]);
    });
});

describe("an author's card sets its fields on a row of the kind its patch names", () => {
    test("a state's through its card, a transition's through its line, a lane's through its header, a decision's through its diamond: one set of the card's fields", () => {
        const cases: [SetCard, FlowchartDropAt, string, ReturnType<typeof planned>][] = [
            [NOTE, at("state", "CH*"), "set states CH*", { kind: "set", sort: "states", key: "CH*", sets: writes(NOTE.sets), what: { what: "state", key: "CH*" } }],
            [TAGGED, at("transition", "t3"), "set transitions t3", { kind: "set", sort: "transitions", key: "t3", sets: writes(TAGGED.sets), what: { what: "transition", from: "CH*", to: "LDD" } }],
            [SORTATION, at("header", "sort"), "set lanes sort", { kind: "set", sort: "lanes", key: "sort", sets: writes(SORTATION.sets), what: { what: "header", lane: "Sort" } }],
            [CUSTOMS, at("decision", "route"), "set decisions route", { kind: "set", sort: "decisions", key: "route", sets: writes(CUSTOMS.sets), what: { what: "decision", label: "route" } }],
        ];
        for (const [card, where, edit, plan] of cases) {
            const made = planDrop(card, where, ctx());
            expect(planned(made), card.label).toEqual(plan);
            expect(lines(dropEdits(made, holdingOf(DEPOT))), card.label).toEqual({ edits: [edit], key: undefined });
        }
    });
});

describe("a drop is refused, in its words", () => {
    test("anywhere but what its card lands on — naming where it lands — and a state's card over No lane", () => {
        const cases: [FlowchartDropCard, FlowchartDropAt, string][] = [
            [HELD, ON_CANVAS, "Drop onto a lane"],
            [HELD, at("state", "ARV"), "Drop onto a lane"],
            [OBSERVED, ON_CANVAS, "Drop onto a transition"],
            [OBSERVED, lane("sort", 0), "Drop onto a transition"],
            [DOCK, at("header", "sort"), "Drop between the lanes"],
            [NOTE, ON_CANVAS, "Drop onto a state"],
            [TAGGED, at("state", "CH*"), "Drop onto a transition"],
            [SORTATION, ON_CANVAS, "Drop onto a lane's header"],
            [CUSTOMS, at("state", "ARV"), "Drop onto a decision"],
        ];
        for (const [card, where, said] of cases) {
            const plan = planDrop(card, where, ctx());
            expect(plan.kind, `${card.label} on ${text(where)}`).toBe("refused");
            expect([dropCaption(plan, m), dropRefusal(plan, m)]).toEqual([said, said]);
            expect(dropEdits(plan, holdingOf(DEPOT))).toBeUndefined();
            expect(markOf(plan)).toBeUndefined();
        }
        expect(dropCaption(planDrop(HELD, lane(NO_LANE_KEY, 0), ctx(modelOf(NARROWED))), m)).toBe("Drop onto a lane");
        // A Flowchart given no lanes has no gap to drop a lane in.
        expect(dropCaption(planDrop(DOCK, gap(0), ctx(modelOf(rowsOf({ states: [stateRow("A", "A")] })))), m)).toBe("Drop between the lanes");
    });

    test("a card of a kind read only, or taking no edit now, is refused wherever it rests, naming its kind — the other kinds' cards landing", () => {
        const readOnly = ctx(model, { editable: (sort) => sort !== "states" });
        for (const [card, where] of [[HELD, lane("sort", 0)], [HELD, ON_CANVAS], [NOTE, at("state", "CH*")]] as const) {
            expect(dropCaption(planDrop(card, where, readOnly), m)).toBe("States are read only");
        }
        expect(planDrop(OBSERVED, at("transition", "t3"), readOnly).kind).toBe("retype");
        const busy = ctx(model, { available: (sort) => sort !== "lanes" });
        expect(dropCaption(planDrop(DOCK, gap(1), busy), m)).toBe("Lanes take no edit now");
        expect(dropCaption(planDrop(SORTATION, at("header", "sort"), busy), m)).toBe("Lanes take no edit now");
        expect(planDrop(HELD, lane("sort", 0), busy).kind).toBe("addState");
        // Read only says so before busy.
        expect(dropCaption(planDrop(CUSTOMS, ON_CANVAS, ctx(model, { editable: () => false, available: () => false })), m)).toBe("Decisions are read only");
    });

    test("a card adding a row of a kind whose keys can't be typed, building none, is refused wherever it rests, saying why — a card setting fields lands (#1549)", () => {
        const blobs = ctx(model, { untyped: (sort) => (sort === "lanes" ? "Blob" : undefined) });
        const said = "Lanes are keyed by Blob, which can't be typed — give the kind `key` to add them";
        for (const where of [gap(1), ON_CANVAS]) {
            const plan = planDrop(DOCK, where, blobs);
            expect([dropCaption(plan, m), dropRefusal(plan, m)]).toEqual([said, said]);
        }
        expect(planDrop(HELD, lane("sort", 0), blobs).kind).toBe("addState");
        expect(planDrop(SORTATION, at("header", "sort"), blobs).kind).toBe("set");
    });

    test("a state's card over a lane held under a placeholder — a new lane of lanes keyed by DateTime, its key still to be typed — is refused, saying so (#1549)", () => {
        const early = printFor(DateTimeType)(new Date("2026-11-07T06:00:00.000Z"));
        const shifts = modelOf(rowsOf({
            lanes: [laneRow(early, "Early", 1), laneRow("lane-2", "Lane 2", 2)],
            states: [stateRow("A", "Arrived", { lane: early, order: 1 })],
            keys: { ...STRING_KIND_KEYS, lanes: kindKeys(toEastTypeValue(DateTimeType)) },
        }));
        const plan = planDrop(HELD, lane("lane-2", 0), ctx(shifts));
        expect([dropCaption(plan, m), dropRefusal(plan, m)]).toEqual(["Type the new lane's key first", "Type the new lane's key first"]);
        expect(planDrop(HELD, lane(early, 1), ctx(shifts)).kind).toBe("addState");
    });

    test("what it lands on gone from the drawing — a stale coordinate, a ghost, a row drawn as context, No lane's header — refuses it without words, asking no table for any", () => {
        const host: FlowchartMessages = { ...m, dropRefused: () => "Not here" };
        const narrowed = ctx(modelOf(NARROWED));
        const cases: [FlowchartDropCard, FlowchartDropAt][] = [
            [HELD, lane("gone", 0)], [OBSERVED, at("transition", "GONE")], [OBSERVED, at("transition", "t3")], [TAGGED, at("transition", "t3")],
            [NOTE, at("state", "GONE")], [NOTE, at("state", "CH*")], [NOTE, at("state", "LOST")],
            [SORTATION, at("header", "gone")], [SORTATION, at("header", NO_LANE_KEY)], [CUSTOMS, at("decision", "gone")],
        ];
        for (const [card, where] of cases) {
            const plan = planDrop(card, where, narrowed);
            expect(plan, `${card.label} on ${text(where)}`).toEqual({ kind: "refused", why: { why: "gone" } });
            expect([dropCaption(plan, m), dropRefusal(plan, m)]).toEqual([undefined, undefined]);
            expect([dropCaption(plan, host), dropRefusal(plan, host)]).toEqual([undefined, undefined]);
        }
        const elsewhere = planDrop(HELD, ON_CANVAS, ctx());
        expect([dropCaption(elsewhere, host), dropRefusal(elsewhere, host)]).toEqual(["Not here", "Not here"]);
    });
});

// ============================================================================
// ⏎ on a card
// ============================================================================

describe("⏎ on a card is a drop on the canvas's selection", () => {
    test("a state's card: after the selected state, in its lane; with a lane selected, at the end of that lane; with neither, at the end of the first lane", () => {
        expect(text(enterAt("lane", { kind: "state", key: "ARV" }, model))).toBe(text(lane("intake", 1)));
        expect(text(enterAt("lane", { kind: "state", key: "SCN" }, model))).toBe(text(lane("intake", 2)));
        expect(text(enterAt("lane", { kind: "state", key: "CH*" }, model))).toBe(text(lane("sort", 1)));
        expect(text(enterAt("lane", { kind: "lane", key: "sort" }, model))).toBe(text(lane("sort", 1)));
        expect(text(enterAt("lane", { kind: "lane", key: "hold" }, model))).toBe(text(lane("hold", 0)));
        // Several states selected are none of these, as are a lane or a state the drawing no longer holds and a transition.
        for (const selection of [null, { kind: "link", key: "t3" }, { kind: "state", key: "GONE" }, { kind: "lane", key: "gone" },
            { kind: "states", keys: ["ARV", "CH*"] }] as const) {
            expect(text(enterAt("lane", selection, model))).toBe(text(lane("intake", 2)));
        }
        // A state in No lane, or one drawn as context, is none either.
        const narrowed = modelOf(NARROWED);
        expect(text(enterAt("lane", { kind: "state", key: "LOOSE" }, narrowed))).toBe(text(lane("intake", 2)));
        expect(text(enterAt("lane", { kind: "state", key: "CH*" }, narrowed))).toBe(text(lane("intake", 2)));
        // A Flowchart given no lanes: its one band's end. One with no band: nowhere.
        expect(text(enterAt("lane", null, modelOf(rowsOf({ states: [stateRow("A", "A")] }))))).toBe(text(lane(ALL_LANE_KEY, 1)));
        expect(text(enterAt("lane", null, modelOf(rowsOf({ lanes: [] }))))).toBe(text(ON_CANVAS));
    });

    test("a lane's card: after the selected lane, else at the band row's tail; a Flowchart given no lanes has no gap", () => {
        expect(text(enterAt("gap", { kind: "lane", key: "sort" }, model))).toBe(text(gap(2)));
        expect(text(enterAt("gap", { kind: "lane", key: "hold" }, model))).toBe(text(gap(4)));
        expect(text(enterAt("gap", null, model))).toBe(text(gap(4)));
        expect(text(enterAt("gap", { kind: "state", key: "CH*" }, model))).toBe(text(gap(4)));
        expect(text(enterAt("gap", null, modelOf(rowsOf({ states: [stateRow("A", "A")] }))))).toBe(text(ON_CANVAS));
    });

    test("any other card on the selected state, transition, decision or lane when that is what it lands on — never a ghost or a row drawn as context", () => {
        expect(text(enterAt("state", { kind: "state", key: "CH*" }, model))).toBe(text(at("state", "CH*")));
        expect(text(enterAt("state", null, model))).toBe(text(ON_CANVAS));
        expect(text(enterAt("state", { kind: "states", keys: ["ARV", "CH*"] }, model))).toBe(text(ON_CANVAS));
        expect(text(enterAt("state", { kind: "lane", key: "sort" }, model))).toBe(text(ON_CANVAS));
        expect(text(enterAt("transition", { kind: "link", key: "t3" }, model))).toBe(text(at("transition", "t3")));
        // An in-place transition has no line to drop on: its ↻ badge selects it, by its key, and ⏎ gives it the card's values.
        expect(text(enterAt("transition", { kind: "link", key: "t4" }, model))).toBe(text(at("transition", "t4")));
        expect(text(enterAt("transition", { kind: "state", key: "CH*" }, model))).toBe(text(ON_CANVAS));
        expect(text(enterAt("transition", { kind: "link", key: "GONE" }, model))).toBe(text(ON_CANVAS));
        expect(text(enterAt("decision", { kind: "trigger", key: "route" }, model))).toBe(text(at("decision", "route")));
        expect(text(enterAt("decision", { kind: "link", key: "t2" }, model))).toBe(text(ON_CANVAS));
        expect(text(enterAt("header", { kind: "lane", key: "sort" }, model))).toBe(text(at("header", "sort")));
        expect(text(enterAt("header", { kind: "lane", key: "gone" }, model))).toBe(text(ON_CANVAS));
        expect(text(enterAt("header", { kind: "state", key: "CH*" }, model))).toBe(text(ON_CANVAS));
        const narrowed = modelOf(NARROWED);
        expect(text(enterAt("state", { kind: "state", key: "CH*" }, narrowed))).toBe(text(ON_CANVAS));
        expect(text(enterAt("state", { kind: "state", key: "GONE" }, narrowed))).toBe(text(ON_CANVAS));
        expect(text(enterAt("transition", { kind: "link", key: "t3" }, narrowed))).toBe(text(ON_CANVAS));
        expect(text(enterAt("header", { kind: "lane", key: NO_LANE_KEY }, narrowed))).toBe(text(ON_CANVAS));
    });

    test("where it lands it does what a drop there does; where it would be refused, the footer says why in the drop's own words", () => {
        expect(lines(dropEdits(planDrop(SORTATION, enterAt("header", { kind: "lane", key: "sort" }, model), ctx()), holdingOf(DEPOT)))?.edits).toEqual(["set lanes sort"]);
        expect(lines(dropEdits(planDrop(OBSERVED, enterAt("transition", { kind: "link", key: "t4" }, model), ctx()), holdingOf(DEPOT)))?.edits)
            .toEqual([`retypeTransition t4 ${bytes(CARD)}`]);
        expect(dropRefusal(planDrop(OBSERVED, enterAt("transition", { kind: "state", key: "CH*" }, model), ctx()), m)).toBe("Drop onto a transition");
        expect(dropRefusal(planDrop(SORTATION, enterAt("header", { kind: "state", key: "CH*" }, model), ctx()), m)).toBe("Drop onto a lane's header");
    });
});

// ============================================================================
// Its words, its marks, and where the canvas draws them
// ============================================================================

describe("its words and its marks", () => {
    test("the ghost says where a card lands, or what it sets its fields on; the drag layer names the place; the history names the drop", () => {
        const between = planDrop(HELD, lane("intake", 1), ctx());
        expect([dropCaption(between, m), dropName(between, m), dropLabel(between, HELD, m)])
            .toEqual(["after ARV in Intake", "Intake, after ARV", "Drop Held on Intake, after ARV"]);
        const first = planDrop(HELD, lane("sort", 0), ctx());
        expect([dropCaption(first, m), dropName(first, m)]).toEqual(["at the start of Sort", "the start of Sort"]);
        const empty = planDrop(HELD, lane("hold", 0), ctx());
        expect([dropCaption(empty, m), dropName(empty, m)]).toEqual(["in Hold", "Hold"]);
        // A Flowchart given no lanes names none.
        const bare = modelOf(rowsOf({ states: [stateRow("A", "A")] }));
        const after = planDrop(HELD, lane(ALL_LANE_KEY, 1), ctx(bare));
        expect([dropCaption(after, m), dropName(after, m), dropLabel(after, HELD, m)]).toEqual(["after A", "the row after A", "Drop Held on the row after A"]);
        const start = planDrop(HELD, lane(ALL_LANE_KEY, 0), ctx(bare));
        expect([dropCaption(start, m), dropName(start, m)]).toEqual(["at the start", "the start"]);
        const before = planDrop(DOCK, gap(1), ctx());
        expect([dropCaption(before, m), dropName(before, m), dropLabel(before, DOCK, m)]).toEqual(["before Sort", "the gap before Sort", "Drop Dock on the gap before Sort"]);
        const end = planDrop(DOCK, gap(4), ctx());
        expect([dropCaption(end, m), dropName(end, m), dropLabel(end, DOCK, m)])
            .toEqual(["at the end of the lanes", "the end of the lanes", "Drop Dock on the end of the lanes"]);
        const retype = planDrop(OBSERVED, at("transition", "t3"), ctx());
        expect([dropCaption(retype, m), dropName(retype, m), dropLabel(retype, OBSERVED, m)]).toEqual(["onto CH* → LDD", "CH* → LDD", "Drop Observed on CH* → LDD"]);
        expect(dropCaption(planDrop(NOTE, at("state", "CH*"), ctx()), m)).toBe("onto CH*");
        expect(dropCaption(planDrop(SORTATION, at("header", "sort"), ctx()), m)).toBe("onto lane Sort");
        expect(dropCaption(planDrop(CUSTOMS, at("decision", "route"), ctx()), m)).toBe("onto decision route");
        expect(dropName(planDrop(OBSERVED, ON_CANVAS, ctx()), m)).toBe("the canvas");
        expect(dropRefusal(between, m)).toBeUndefined();
    });

    test("the canvas marks the lane and the row a state lands in, the gap a lane lands in, a lane whose header a card sets, or what a card sets its fields on", () => {
        expect(markOf(planDrop(HELD, lane("intake", 1), ctx()))).toEqual({ kind: "lane", lane: "intake", row: 1 });
        expect(markOf(planDrop(DOCK, gap(1), ctx()))).toEqual({ kind: "gap", at: 1 });
        expect(markOf(planDrop(SORTATION, at("header", "sort"), ctx()))).toEqual({ kind: "header", lane: "sort" });
        expect(markOf(planDrop(OBSERVED, at("transition", "t3"), ctx()))).toEqual({ kind: "transition", key: "t3" });
        expect(markOf(planDrop(TAGGED, at("transition", "t3"), ctx()))).toEqual({ kind: "transition", key: "t3" });
        expect(markOf(planDrop(NOTE, at("state", "ARV"), ctx()))).toEqual({ kind: "state", key: "ARV" });
        expect(markOf(planDrop(CUSTOMS, at("decision", "route"), ctx()))).toEqual({ kind: "decision", key: "route" });
        // One mark is another only where it marks the same place.
        expect(markEqual({ kind: "lane", lane: "sort", row: 1 }, { kind: "lane", lane: "sort", row: 1 })).toBe(true);
        expect(markEqual({ kind: "lane", lane: "sort", row: 1 }, { kind: "lane", lane: "sort", row: 2 })).toBe(false);
        expect(markEqual({ kind: "gap", at: 1 }, { kind: "gap", at: 1 })).toBe(true);
        expect(markEqual({ kind: "gap", at: 1 }, { kind: "gap", at: 2 })).toBe(false);
        expect(markEqual({ kind: "header", lane: "sort" }, { kind: "lane", lane: "sort", row: 0 })).toBe(false);
        expect(markEqual({ kind: "state", key: "ARV" }, { kind: "transition", key: "ARV" })).toBe(false);
        expect(markEqual({ kind: "state", key: "ARV" }, { kind: "state", key: "ARV" })).toBe(true);
        expect(markEqual(undefined, undefined)).toBe(true);
        expect(markEqual({ kind: "state", key: "ARV" }, undefined)).toBe(false);
    });

    test("a state's landing line lies across a node's footprint, centred on the gap before its row: the 16px under the header before the first, half the gap between two rows before another — upright, top down", () => {
        const intake = bandOf(layout, "intake");
        expect(rowCell(layout, intake, 1)).toEqual({ x: 25, y: 152, w: 116, h: 40 });
        expect(landingSeam(layout, intake, 0)).toEqual({ x: 25, y: 48, w: 116, h: 0 });
        expect(landingSeam(layout, intake, 1)).toEqual({ x: 25, y: 124, w: 116, h: 0 });
        expect(landingSeam(layout, intake, 2)).toEqual({ x: 25, y: 220, w: 116, h: 0 });
        const td = drawn(DEPOT, "TD");
        const sort = bandOf(td.layout, "sort");
        const chutes = td.layout.nodes.get("CH*")!;
        expect(rowCell(td.layout, sort, 0)).toEqual({ x: chutes.x, y: chutes.y, w: chutes.w, h: chutes.h });
        expect(landingSeam(td.layout, sort, 0)).toEqual({ x: chutes.x - 8, y: chutes.y, w: 0, h: 40 });
        const pitch = td.layout.rows[1]!.start - td.layout.rows[0]!.start;
        expect(landingSeam(td.layout, sort, 1)).toEqual({ x: chutes.x + pitch - (pitch - 116) / 2, y: chutes.y, w: 0, h: 40 });
    });

    test("over cards as tall as their reads, a state lands by its row's middle, its cell the row's span across the card, its line in the middle of the gap before the row — top down, across the tallest card", () => {
        const cards = { width: 272, heights: new Map([["ARV", 120], ["SCN", 200], ["CH*", 80], ["LDD", 160]]) };
        const sized = computeLayout(model, { width: 0, orientation: "LR", cards });
        const intake = bandOf(sized, "intake");
        // Row 0 holds ARV, CH* and LDD, as tall as LDD's 160; row 1, SCN's 200; 56 between them.
        expect(rowCell(sized, intake, 0)).toEqual({ x: 25, y: 56, w: 272, h: 160 });
        expect(rowCell(sized, intake, 1)).toEqual({ x: 25, y: 272, w: 272, h: 200 });
        expect([0, 1, 2].map((row) => landingSeam(sized, intake, row))).toEqual([
            { x: 25, y: 48, w: 272, h: 0 }, { x: 25, y: 244, w: 272, h: 0 }, { x: 25, y: 500, w: 272, h: 0 },
        ]);
        const x = intake.x + intake.w / 2;
        const arrived = sized.nodes.get("ARV")!, scanned = sized.nodes.get("SCN")!;
        expect(text(dropAtPoint("lane", sized, model, { x, y: arrived.cy }))).toBe(text(lane("intake", 0)));
        expect(text(dropAtPoint("lane", sized, model, { x, y: arrived.cy + 1 }))).toBe(text(lane("intake", 1)));
        expect(text(dropAtPoint("lane", sized, model, { x, y: scanned.cy }))).toBe(text(lane("intake", 1)));
        expect(text(dropAtPoint("lane", sized, model, { x, y: scanned.cy + 1 }))).toBe(text(lane("intake", 2)));
        const td = computeLayout(model, { width: 0, orientation: "TD", cards });
        const tdIntake = bandOf(td, "intake");
        expect(rowCell(td, tdIntake, 1)).toEqual({ x: 380, y: 36, w: 272, h: 200 });
        expect(landingSeam(td, tdIntake, 1)).toEqual({ x: 354, y: 36, w: 0, h: 200 });
    });

    test("a lane's landing line stands at the start of the lane it lands before, or the end of the last — across, LR's x; top down, its y", () => {
        const hold = bandOf(layout, "hold");
        expect([0, 2, 4].map((g) => gapLine(layout, g))).toEqual([bandOf(layout, "intake").x, bandOf(layout, "load").x, hold.x + hold.w]);
        const td = drawn(DEPOT, "TD");
        const tdHold = bandOf(td.layout, "hold");
        expect([gapLine(td.layout, 1), gapLine(td.layout, 4)]).toEqual([bandOf(td.layout, "sort").y, tdHold.y + tdHold.h]);
    });
});

// ============================================================================
// What the canvas takes
// ============================================================================

describe("what the canvas takes dropped", () => {
    test("each tab whose cards drop, under the library its cards drag from: the Steps, Transitions and Lanes tabs' cards, and an author's tab's by the kind its patch names — never an author's tab with no drop", () => {
        const kindCard = (key: string, name: string) => ({ key, name, group: none, values: CARD });
        const card = (key: string, label: string, sets: SetCard["sets"]) => ({ key, label, meta: none, group: none, sets });
        const host = dropHostOf("flowchart.surface", (tab) => `lib:${tab}`, [
            variant("states", { name: none, icon: none }),
            variant("transitions", { name: some("Moves"), icon: none }),
            variant("lanes", { name: none, icon: none }),
            variant("tab", { name: "Notes", icon: none, drop: some("states"), cards: [card("n", "Checked", NOTE.sets)], source: none }),
            variant("tab", { name: "Owners", icon: some("user"), drop: some("decisions"), cards: [card("c", "Customs desk", CUSTOMS.sets)], source: some("owners") }),
            variant("tab", { name: "Desks", icon: none, drop: none, cards: [card("d", "Hold bay", [])], source: none }),
        ], { states: [kindCard("HLD", "Held")], transitions: [kindCard("obs", "Observed")], lanes: [kindCard("dock", "Dock")] });
        expect(host.surface).toBe("flowchart.surface");
        expect([...host.libraries.keys()]).toEqual(["lib:states", "lib:transitions", "lib:lanes", "lib:tab:Notes", "lib:tab:Owners"]);
        expect([...host.libraries.values()].map((cards) => [...cards.values()].map((c) => [c.does, c.label, cardSort(c), landsOf(c)]))).toEqual([
            [["addState", "Held", "states", "lane"]],
            [["retype", "Observed", "transitions", "transition"]],
            [["addLane", "Dock", "lanes", "gap"]],
            [["set", "Checked", "states", "state"]],
            [["set", "Customs desk", "decisions", "decision"]],
        ]);
        const held = cardOf(host, "lib:states", "HLD");
        expect(held?.does === "addState" ? bytes(held.values) : undefined).toBe(bytes(CARD));
        const owner = cardOf(host, "lib:tab:Owners", "c");
        expect(owner?.does === "set" ? writes(owner.sets) : undefined).toBe(writes(CUSTOMS.sets));
        expect([cardOf(host, "lib:states", "GONE"), cardOf(host, "lib:tab:Desks", "d")]).toEqual([undefined, undefined]);
    });
});
