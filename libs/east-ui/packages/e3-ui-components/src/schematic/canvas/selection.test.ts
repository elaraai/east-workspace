/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 */

/**
 * Unit tests for the pure selection rules (`selection.ts`) — the marquee hit
 * collection. Fixtures are real East values typed from the drawn item's East
 * type, its default value keyed and placed.
 */

import { describe, it, expect } from "vitest";
import { defaultValue } from "@elaraai/east";
import RBush from "rbush";
import { SchematicDrawnItemType } from "./drawn";
import { EMPTY_STRING_SET, type ItemBox, marqueeHits } from "./selection";

describe("marqueeHits", () => {
    // Padded boxes (±2 world units), mirroring the culling tree: an item whose
    // PADDING overlaps the region but whose CENTER is outside must not select.
    const box = (key: string, x: number, y: number): ItemBox => ({
        minX: x - 2, minY: y - 2, maxX: x + 2, maxY: y + 2,
        item: { ...defaultValue<typeof SchematicDrawnItemType>(SchematicDrawnItemType), key, label: key, x, y },
    });
    const tree = () => {
        const t = new RBush<ItemBox>();
        t.load([box("A", 5, 5), box("B", 9, 5), box("C", 11.5, 5), box("D", 30, 30)]);
        return t;
    };
    const region = { minX: 4, minY: 4, maxX: 10, maxY: 6 };

    it("selects items whose CENTER lies in the region — padded overlap alone does not select", () => {
        // C's padded box (9.5..13.5) overlaps the region edge at 10, but its centre (11.5) is outside.
        expect([...marqueeHits(tree(), region, EMPTY_STRING_SET, EMPTY_STRING_SET)].sort()).toEqual(["A", "B"]);
    });

    it("skips locked items and narrowed-out items drawn dimmed", () => {
        expect([...marqueeHits(tree(), region, new Set(["A"]), EMPTY_STRING_SET)]).toEqual(["B"]);
        expect([...marqueeHits(tree(), region, EMPTY_STRING_SET, new Set(["B"]))]).toEqual(["A"]);
        expect([...marqueeHits(tree(), region, new Set(["A"]), new Set(["B"]))]).toEqual([]);
    });

    it("returns empty for a region with no candidates", () => {
        expect(marqueeHits(tree(), { minX: 100, minY: 100, maxX: 101, maxY: 101 }, EMPTY_STRING_SET, EMPTY_STRING_SET).size).toBe(0);
    });
});
