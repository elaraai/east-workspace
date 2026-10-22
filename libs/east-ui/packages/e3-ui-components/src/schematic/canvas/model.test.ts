/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Pure derived-model tests (#183 WS3/WS5): the navigator tree's
 * containment nesting + item hosting rules, and the symmetric
 * neighbour-fit declutter that drives semantic zoom.
 */

import { describe, test, expect } from "vitest";
import { defaultValue, variant, some, none } from "@elaraai/east";
import { SchematicDrawnItemType, SchematicDrawnZoneType, type DrawnItem, type DrawnZone } from "./drawn";
import { buildCenterTree, buildNavTree, declutterTiers, tierSize } from "./model";

type ItemValue = DrawnItem;
type ZoneValue = DrawnZone;

/** An item at (x, y): the drawn item type's default value, keyed and placed. */
function item(key: string, x: number, y: number, label = key): ItemValue {
    return { ...defaultValue<typeof SchematicDrawnItemType>(SchematicDrawnItemType), key, x, y, label };
}

/** A zone over a rect: the drawn zone type's default value, keyed, placed and patterned. */
function zone(key: string, x: number, y: number, width: number, height: number, pattern: "outline" | "hatch" = "outline"): ZoneValue {
    return {
        ...defaultValue<typeof SchematicDrawnZoneType>(SchematicDrawnZoneType),
        key, label: key, x, y, width, height,
        pattern: pattern === "hatch"
            ? variant("hatch", { tone: none, spacing: none, angle: none })
            : variant("outline", { tone: none }),
    };
}

describe("buildNavTree", () => {
    test("nests zones by smallest containing rect and hosts items in their smallest outline zone", () => {
        const hall = zone("hall", 0, 0, 20, 10);
        const cage = zone("cage", 1, 1, 5, 4);
        const rack = item("R1", 2, 2);         // inside cage (and hall) → cage wins
        const pdu = item("P1", 15, 5);         // inside hall only
        const generator = item("G1", 30, 30);  // outside every zone → floor
        const { roots, floor, zoneOf, parentOf } = buildNavTree([hall, cage], [rack, pdu, generator]);
        expect(roots.map(r => r.zone.key)).toEqual(["hall"]);
        expect(roots[0]!.children.map(c => c.zone.key)).toEqual(["cage"]);
        expect(parentOf.get("cage")).toBe("hall");
        expect(zoneOf.get("R1")).toBe("cage");
        expect(zoneOf.get("P1")).toBe("hall");
        expect(floor.map(f => f.key)).toEqual(["G1"]);
    });

    test("hatch zones are annotations — they never host items and never parent", () => {
        const aisle = zone("aisle", 0, 0, 20, 10, "hatch");
        const inside = item("R1", 5, 5);
        const { roots, floor, zoneOf } = buildNavTree([aisle], [inside]);
        expect(roots.map(r => r.zone.key)).toEqual(["aisle"]);  // still listed…
        expect(zoneOf.has("R1")).toBe(false);                    // …but hosts nothing
        expect(floor.map(f => f.key)).toEqual(["R1"]);
    });
});

describe("declutterTiers", () => {
    test("dot band ⇒ every item is a dot (no neighbour work)", () => {
        const items = [item("A", 1, 1), item("B", 1.1, 1)];
        const tiers = declutterTiers(items, buildCenterTree(items), "dot", 8, new Set());
        expect([...tiers.values()]).toEqual(["dot", "dot"]);
    });

    test("isolated items keep the band's richest form; a dense pair degrades together", () => {
        const isolated = item("LONE", 50, 50);
        const a = item("A", 1, 1), b = item("B", 1.2, 1);   // ~0.2 world units apart
        const items = [a, b, isolated];
        const tiers = declutterTiers(items, buildCenterTree(items), "card", 30, new Set());
        expect(tiers.get("LONE")).toBe("card");
        // At 30 ppu two cards ~6 px apart can never both fit — neither keeps a card.
        expect(tiers.get("A")).not.toBe("card");
        expect(tiers.get("B")).not.toBe("card");
    });

    test("a selected item never demotes below the band's richest form", () => {
        const a = item("A", 1, 1), b = item("B", 1.2, 1);
        const items = [a, b];
        const tiers = declutterTiers(items, buildCenterTree(items), "card", 30, new Set(["A"]));
        expect(tiers.get("A")).toBe("card");
    });
});

describe("tierSize", () => {
    test("label tier scales with label length; card tier honours an explicit width", () => {
        expect(tierSize(item("X", 0, 0, "AB"), "label", 30).w)
            .toBeLessThan(tierSize(item("Y", 0, 0, "A MUCH LONGER LABEL"), "label", 30).w);
        const wide: ItemValue = { ...item("W", 0, 0), width: some(4) };
        expect(tierSize(wide, "card", 30).w).toBe(120);   // 4 world units × 30 ppu
    });
});
