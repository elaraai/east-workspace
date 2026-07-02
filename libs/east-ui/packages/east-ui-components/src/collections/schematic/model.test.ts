/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * Pure derived-model tests (#183 WS3/WS5): the navigator tree's
 * containment nesting + item hosting rules, and the symmetric
 * neighbour-fit declutter that drives semantic zoom.
 */

import { describe, test, expect } from "vitest";
import { variant, some, none, type ValueTypeOf } from "@elaraai/east";
import { Schematic } from "@elaraai/east-ui/internal";
import { buildCenterTree, buildNavTree, declutterTiers, tierSize } from "./model";

type ItemValue = ValueTypeOf<typeof Schematic.Types.Item>;
type ZoneValue = ValueTypeOf<typeof Schematic.Types.Zone>;

function item(key: string, x: number, y: number, label = key): ItemValue {
    return {
        key, x, y, label,
        sublabel: none, icon: none, status: none, meter: none, metric: none,
        width: none, footprint: none, tone: none, color: none, layer: none,
    } as unknown as ItemValue;
}

function zone(key: string, x: number, y: number, width: number, height: number, pattern: "outline" | "hatch" = "outline"): ZoneValue {
    return {
        key, label: key, x, y, width, height,
        pattern: variant(pattern, null), geometry: none, tone: none, color: none, layer: none,
    } as unknown as ZoneValue;
}

describe("buildNavTree", () => {
    test("nests zones by smallest containing rect and hosts items in their smallest outline zone", () => {
        const hall = zone("hall", 0, 0, 20, 10);
        const cell = zone("cell", 1, 1, 5, 4);
        const tank = item("T1", 2, 2);       // inside cell (and hall) → cell wins
        const packer = item("P1", 15, 5);    // inside hall only
        const yard = item("Y1", 30, 30);     // outside every zone → floor
        const { roots, floor, zoneOf, parentOf } = buildNavTree([hall, cell], [tank, packer, yard]);
        expect(roots.map(r => r.zone.key)).toEqual(["hall"]);
        expect(roots[0]!.children.map(c => c.zone.key)).toEqual(["cell"]);
        expect(parentOf.get("cell")).toBe("hall");
        expect(zoneOf.get("T1")).toBe("cell");
        expect(zoneOf.get("P1")).toBe("hall");
        expect(floor.map(f => f.key)).toEqual(["Y1"]);
    });

    test("hatch zones are annotations — they never host items and never parent", () => {
        const walkway = zone("walk", 0, 0, 20, 10, "hatch");
        const inside = item("T1", 5, 5);
        const { roots, floor, zoneOf } = buildNavTree([walkway], [inside]);
        expect(roots.map(r => r.zone.key)).toEqual(["walk"]);   // still listed…
        expect(zoneOf.has("T1")).toBe(false);                    // …but hosts nothing
        expect(floor.map(f => f.key)).toEqual(["T1"]);
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
        const wide = { ...item("W", 0, 0), width: some(4) } as unknown as ItemValue;
        expect(tierSize(wide, "card", 30).w).toBe(120);   // 4 world units × 30 ppu
    });
});
