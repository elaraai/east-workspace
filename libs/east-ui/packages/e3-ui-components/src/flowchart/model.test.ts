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
 * The Flowchart's model (#1502, `Flowchart Records Spec.md` R6, R7, D4, D12),
 * pure, over rows as the read holds them: the lanes by their `order`, else by
 * key, and each lane's states by theirs, else by key — the same under every
 * index the rail picks, though each pages its rows in its own order; a state
 * naming no lane the flowchart holds in a last band, *No lane*; one band when
 * no lanes are given; an end no state is keyed by drawn as a ghost beside the
 * end that resolves; in-place transitions folded into their state's `↻`; the
 * decisions lettered, each with the transitions it governs; and what the
 * flowchart holds counted, what the narrowing leaves out counting nowhere.
 *
 * @packageDocumentation
 */

import { describe, expect, test } from "vitest";
import { some } from "@elaraai/east";
import { ALL_LANE_KEY, NO_LANE_KEY, type FlowchartModel } from "./model.js";
import { decisionRow, laneRow, modelOf, rowsOf, stateRow, transitionRow, words } from "./rows.test-utils.js";

const m = words.m;

/**
 * What a test reads of a model's bands: each band's key, header and kind, and
 * its states in their order.
 *
 * @param model - The model
 * @returns The bands
 */
function bands(model: FlowchartModel) {
    return model.lanes.map((lane, i) => ({
        key: lane.key, label: lane.label, band: lane.band,
        states: model.nodes.filter((node) => node.laneIndex === i).sort((a, b) => a.laneOrder - b.laneOrder).map((node) => node.key),
    }));
}

/**
 * What a test reads of a ghost: whether it is one, its band's key, whether it
 * is faded, and its card's name.
 *
 * @param model - The model
 * @param key - The end it stands for
 * @returns What the test compares
 */
function ghostOf(model: FlowchartModel, key: string) {
    const node = model.nodesByKey.get(key)!;
    return [node.ghost, model.lanes[node.laneIndex]!.key, node.dimmed, node.label];
}

describe("the order (R7, D4)", () => {
    const intake = laneRow("intake", "Intake", 1);
    const sort = laneRow("sort", "Sort", 2);
    const load = laneRow("load", "Load");
    const dock = laneRow("dock", "Dock");
    const arrived = stateRow("ARV", "Arrived", { lane: "intake" });
    const scanned = stateRow("SCN", "Scanned", { lane: "intake" });
    const bagged = stateRow("BAG", "Bagged", { lane: "sort" });
    const chutes = stateRow("CH*", "Sort chutes", { lane: "sort" });
    const loaded = stateRow("LDD", "Loaded", { lane: "load" });

    test("the same under two indexes: each pages its rows in its own order, and the lanes stand by their order — those with none after, by key — each lane's states by key", () => {
        // A source by label pages Arrived, Bagged, Loaded, Scanned, Sort chutes; one by lane, the lanes' last first.
        const byLabel = modelOf(rowsOf({ lanes: [intake, sort, load, dock], states: [arrived, bagged, loaded, scanned, chutes] }));
        const byLane = modelOf(rowsOf({ lanes: [load, dock, sort, intake], states: [loaded, chutes, bagged, scanned, arrived] }));
        const drawn = [
            { key: "intake", label: "Intake", band: "lane", states: ["ARV", "SCN"] },
            { key: "sort", label: "Sort", band: "lane", states: ["BAG", "CH*"] },
            { key: "dock", label: "Dock", band: "lane", states: [] },
            { key: "load", label: "Load", band: "lane", states: ["LDD"] },
        ];
        expect(bands(byLabel)).toEqual(drawn);
        expect(bands(byLane)).toEqual(drawn);
        expect([byLabel.ordered, byLane.ordered]).toEqual([false, false]);
    });

    test("states given an order stand by it, those with none after them by key — under every index alike — and a move within a lane is offered", () => {
        const first = stateRow("SCN", "Scanned", { lane: "intake", order: 1 });
        const second = stateRow("ARV", "Arrived", { lane: "intake", order: 2.5 });
        const later = stateRow("ZED", "Zoned", { lane: "intake" });
        const earlier = stateRow("AAA", "Aligned", { lane: "intake" });
        const one = modelOf(rowsOf({ lanes: [intake], states: [later, second, earlier, first] }));
        const other = modelOf(rowsOf({ lanes: [intake], states: [first, earlier, second, later] }));
        expect(bands(one)).toEqual([{ key: "intake", label: "Intake", band: "lane", states: ["SCN", "ARV", "AAA", "ZED"] }]);
        expect(bands(other)).toEqual(bands(one));
        expect(one.ordered).toBe(true);
    });

    test("the transitions in key order, and the decisions", () => {
        const model = modelOf(rowsOf({
            states: [arrived, scanned],
            transitions: [transitionRow("t2", "SCN", "ARV"), transitionRow("t1", "ARV", "SCN")],
            decisions: [decisionRow("route", "route"), decisionRow("hold", "hold")],
        }));
        expect(model.links.map((link) => link.key)).toEqual(["t1", "t2"]);
        expect([...model.triggers.keys()]).toEqual(["hold", "route"]);
    });
});

describe("the bands (R7, D12)", () => {
    test("a state naming a lane the flowchart holds none of, or none, stands in a last band, No lane — listed in its order; a lane with no label is headed by its key", () => {
        const model = modelOf(rowsOf({
            lanes: [laneRow("intake", "Intake", 1), laneRow("sort", "", 2)],
            states: [
                stateRow("STR", "Stray", { lane: "gone" }), stateRow("ARV", "Arrived", { lane: "intake" }),
                stateRow("LOOSE", "Loose"), stateRow("CH*", "Sort chutes", { lane: "sort" }),
            ],
        }));
        expect(bands(model)).toEqual([
            { key: "intake", label: "Intake", band: "lane", states: ["ARV"] },
            { key: "sort", label: "sort", band: "lane", states: ["CH*"] },
            { key: NO_LANE_KEY, label: m.noLaneBand(), band: "noLane", states: ["LOOSE", "STR"] },
        ]);
        expect(model.noLane).toEqual(["LOOSE", "STR"]);
        // The state keeps the lane it names; each lane counts the states naming it, the one it has none of too.
        expect([model.nodesByKey.get("STR")!.lane, model.nodesByKey.get("LOOSE")!.lane]).toEqual(["gone", undefined]);
        expect(["intake", "sort", "gone"].map((key) => model.laneStates.get(key))).toEqual([1, 1, 1]);
        expect([model.counts.lanes, model.counts.states, model.standIn]).toEqual([2, 4, false]);
    });

    test("every state in a lane of the flowchart's: no No lane", () => {
        const model = modelOf(rowsOf({ lanes: [laneRow("intake", "Intake", 1)], states: [stateRow("ARV", "Arrived", { lane: "intake" })] }));
        expect(model.lanes.map((lane) => lane.band)).toEqual(["lane"]);
        expect(model.noLane).toEqual([]);
    });

    test("with no lanes given, one band holds every state — whatever lane a state names — and is no lane of the app's", () => {
        const model = modelOf(rowsOf({ states: [stateRow("B", "Bagged", { lane: "gone" }), stateRow("A", "")] }));
        expect(bands(model)).toEqual([{ key: ALL_LANE_KEY, label: "", band: "all", states: ["A", "B"] }]);
        expect([model.standIn, model.noLane, model.counts.lanes, model.blank]).toEqual([true, [], 0, false]);
        // A state's empty label names no card.
        expect(model.nodesByKey.get("A")!.label).toBeUndefined();
    });

    test("lanes given but none held: every state in No lane, and the ghosts; nothing at all is blank", () => {
        const model = modelOf(rowsOf({ lanes: [], states: [stateRow("A", "Arrived")] }));
        expect(bands(model)).toEqual([{ key: NO_LANE_KEY, label: m.noLaneBand(), band: "noLane", states: ["A"] }]);
        expect(model.standIn).toBe(false);
        const ghosts = modelOf(rowsOf({ lanes: [], transitions: [transitionRow("t1", "X", "Y")] }));
        expect(bands(ghosts)).toEqual([{ key: NO_LANE_KEY, label: m.noLaneBand(), band: "noLane", states: ["X", "Y"] }]);
        expect([modelOf(rowsOf({ lanes: [] })).blank, modelOf(rowsOf({})).blank, ghosts.blank]).toEqual([true, true, false]);
    });
});

describe("ghosts, in-place transitions and decisions (R6)", () => {
    test("an end no state is keyed by is a ghost in the band after the end that resolves — the last at most — its transition unresolved; faded only while every transition naming it is", () => {
        const model = modelOf(rowsOf({
            lanes: [laneRow("intake", "Intake", 1), laneRow("sort", "Sort", 2)],
            states: [stateRow("ARV", "Arrived", { lane: "intake" }), stateRow("CH*", "Sort chutes", { lane: "sort" })],
            transitions: [
                transitionRow("t1", "ARV", "GONE"), transitionRow("t2", "CH*", "LOST"), transitionRow("t3", "OFF", "OFF", { dimmed: true }),
                transitionRow("t4", "ARV", "CH*", { kind: "observed" }), transitionRow("t5", "CH*", "GONE", { dimmed: true }), transitionRow("t6", "ARV", "FAR", { dimmed: true }),
            ],
        }));
        expect(ghostOf(model, "GONE")).toEqual([true, "sort", false, m.noStateRow()]);
        expect(ghostOf(model, "LOST")).toEqual([true, "sort", false, m.noStateRow()]);
        expect(ghostOf(model, "FAR")).toEqual([true, "sort", true, m.noStateRow()]);
        expect(ghostOf(model, "OFF")).toEqual([true, "intake", true, m.noStateRow()]);
        expect(model.links.map((link) => [link.key, link.cls, link.dimmed])).toEqual([
            ["t1", "unresolved", false], ["t2", "unresolved", false], ["t4", "observed", false], ["t5", "unresolved", true], ["t6", "unresolved", true],
        ]);
        // What the narrowing leaves out counts nowhere.
        expect(model.counts).toEqual({ total: 3, planned: 0, observed: 1, unresolved: 2, lanes: 2, states: 2, transitions: 3, decisions: 0 });
    });

    test("an in-place transition folds into its state's ↻, in key order — one the narrowing leaves out draws nowhere — and the transitions count those drawn", () => {
        const model = modelOf(rowsOf({
            states: [stateRow("SCN", "Scanned")],
            transitions: [transitionRow("t9", "SCN", "SCN"), transitionRow("t2", "SCN", "SCN"), transitionRow("t5", "SCN", "SCN", { dimmed: true })],
        }));
        expect(model.nodesByKey.get("SCN")!.inPlaceKeys).toEqual(["t2", "t9"]);
        expect([model.links.length, model.counts.total, model.counts.transitions]).toEqual([0, 0, 2]);
    });

    test("each decision lettered — its own letter, else its label's first in upper case, else ? — with the routed transitions it governs and the states it queues", () => {
        const lettered = decisionRow("hold", "hold");
        const model = modelOf(rowsOf({
            states: [stateRow("A", "Arrived"), stateRow("B", "Bagged")],
            transitions: [transitionRow("t2", "A", "B", { decision: "route" }), transitionRow("t1", "B", "A", { decision: "route" }), transitionRow("t3", "A", "A", { decision: "route" })],
            decisions: [decisionRow("route", "route", ["A"]), { ...lettered, roles: { ...lettered.roles, letter: some("H") } }, decisionRow("blank", "")],
        }));
        expect([...model.triggers.values()].map((t) => [t.key, t.letter, t.governs, t.queue])).toEqual([
            ["blank", "?", [], []], ["hold", "H", [], []], ["route", "R", ["t1", "t2"], ["A"]],
        ]);
        expect(model.counts.decisions).toBe(3);
    });
});
