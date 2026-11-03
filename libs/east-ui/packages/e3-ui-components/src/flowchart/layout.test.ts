/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, expect, test } from "vitest";
import { computeLayout, NODE_W } from "./layout.js";
import type { FlowchartModel } from "./model.js";

const model = {
    lanes: [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "c", label: "C" }],
    nodes: [{ key: "n", laneIndex: 1, laneOrder: 0 }],
    nodesByKey: new Map(),
    links: [],
} as unknown as FlowchartModel;

describe("computeLayout's laneWidth (a phone's window of lanes)", () => {
    test("each lane takes the width given, and a state stands in its lane's middle", () => {
        const layout = computeLayout(model, { width: 336, orientation: "LR", laneWidth: 168 });
        expect(layout.lanes.map((lane) => [lane.x, lane.w])).toEqual([[0, 168], [168, 168], [336, 168]]);
        expect(layout.nodes.get("n")!.x).toBe(168 + 84 - NODE_W / 2);
    });

    test("left out, the lanes fill the width, as on a wide frame", () => {
        const layout = computeLayout(model, { width: 1000, orientation: "LR" });
        expect(layout.lanes[0]!.w).toBe(Math.floor((1000 - 78) / 3));
    });
});
