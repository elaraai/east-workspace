/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

import { describe, expect, it } from "vitest";
import { DROP_PAD, dropTargetAt, existingLink, nearestHandle } from "./connect.js";
import type { FlowchartLayout, NodeRect } from "./layout.js";
import type { FlowchartModel } from "./model.js";

const rect = (key: string, x: number, y: number): NodeRect => ({
    key, x, y, w: 116, h: 40, cx: x + 58, cy: y + 20,
    left: { x, y: y + 20 }, right: { x: x + 116, y: y + 20 },
    top: { x: x + 58, y }, bottom: { x: x + 58, y: y + 40 },
});

const layout = {
    nodes: new Map([["A", rect("A", 0, 0)], ["B", rect("B", 200, 0)]]),
} as unknown as FlowchartLayout;

describe("connect helpers", () => {
    it("dropTargetAt accepts the whole node plus the drop pad", () => {
        expect(dropTargetAt(layout, { x: 258, y: 20 })).toBe("B");                    // dead centre
        expect(dropTargetAt(layout, { x: 200 - DROP_PAD + 1, y: 45 })).toBe("B");     // padded corner
        expect(dropTargetAt(layout, { x: 200 - DROP_PAD - 2, y: 90 })).toBeNull();    // beyond pad
        expect(dropTargetAt(layout, { x: 58, y: 20 }, "A")).toBeNull();               // source excluded
    });

    it("existingLink finds same-direction links only", () => {
        const model = { links: [{ key: "k1", from: "A", to: "B" }] } as unknown as FlowchartModel;
        expect(existingLink(model, "A", "B")).toBe("k1");
        expect(existingLink(model, "B", "A")).toBeUndefined();
    });

    it("nearestHandle snaps to the closest edge centre", () => {
        const r = rect("B", 200, 0);
        expect(nearestHandle(r, { x: 190, y: 20 })).toEqual(r.left);
        expect(nearestHandle(r, { x: 258, y: 60 })).toEqual(r.bottom);
    });
});
