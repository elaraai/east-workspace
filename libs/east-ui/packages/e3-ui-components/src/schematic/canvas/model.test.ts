/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Pure derived-model tests (#183 WS3/WS5): the navigator tree's
 * containment nesting + item hosting rules, the symmetric
 * neighbour-fit declutter that drives semantic zoom, and the box the
 * narrowing's matches span (#1392).
 */

import { describe, test, expect } from "vitest";
import { defaultValue, variant, some, none } from "@elaraai/east";
import { SchematicDrawnItemType, SchematicDrawnLinkType, SchematicDrawnZoneType, type DrawnItem, type DrawnZone } from "./drawn";
import { buildCenterTree, buildNavTree, declutterTiers, matchesExtent, tierSize } from "./model";

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

describe("matchesExtent (#1392)", () => {
    const a = item("A", 2, 2);
    const b: ItemValue = { ...item("B", 10, 4), footprint: some(variant("circle", { radius: 3 })) };
    const c = item("C", 40, 40);
    const cage = zone("cage", 20, 0, 4, 4);
    const run = (key: string, from: string, to: string, via: { x: number; y: number }[] = []) => ({
        ...defaultValue<typeof SchematicDrawnLinkType>(SchematicDrawnLinkType), key, from, to, via,
    });
    const drawn = { items: [a, b, c], zones: [cage], links: [run("u1", "A", "B", [{ x: 6, y: 9 }]), run("u9", "A", "GONE")], nets: [] };
    const centers = new Map([a, b, c].map((i) => [i.key, { x: i.x, y: i.y }] as const));
    const reach = () => ({ w: 1, h: 0.5 });

    test("spans each matched item's centre grown by its reach and its footprint about it, and counts them", () => {
        expect(matchesExtent(drawn, new Set(["A", "B"]), new Set(), centers, reach)).toEqual({ box: { minX: 1, minY: 1, maxX: 13, maxY: 7 }, count: 2 });
    });

    test("a matched zone spans its box, and a matched link its ends and its bends — but only while both its ends are drawn", () => {
        expect(matchesExtent(drawn, new Set(["cage"]), new Set(), centers, reach)).toEqual({ box: { minX: 20, minY: 0, maxX: 24, maxY: 4 }, count: 1 });
        expect(matchesExtent(drawn, new Set(["u1"]), new Set(), centers, reach)).toEqual({ box: { minX: 2, minY: 2, maxX: 10, maxY: 9 }, count: 1 });
        expect(matchesExtent(drawn, new Set(["u9"]), new Set(), centers, reach)).toBeUndefined();
    });

    test("what is unmatched, on a hidden layer or drawn nowhere spans nothing; no match spans no box", () => {
        expect(matchesExtent(drawn, new Set(), new Set(), centers, reach)).toBeUndefined();
        expect(matchesExtent(drawn, new Set(["cage"]), new Set(["cage"]), centers, reach)).toBeUndefined();
        // An item off the working set — its layer hidden — has no centre.
        expect(matchesExtent(drawn, new Set(["A", "C"]), new Set(), new Map([["A", { x: 2, y: 2 }]]), reach)?.count).toBe(1);
    });
});
