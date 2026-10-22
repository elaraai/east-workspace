/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What the Schematic's inspector shows (#1391, `inspect.ts`), pure: the
 * selection as Details shows it — the drawing, one entity, a net's leg, or
 * several in the order the canvas selected them, an id the drawing no longer
 * draws left out — whether two of them are one, and what an item is joined to.
 * Fixtures are real East values typed from the Schematic's East types.
 */

import { describe, expect, test } from "vitest";
import { defaultValue, some } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { drawnItem, drawnLink, drawnNet, drawnZone, entityId, type SchematicDrawn, type SchematicRef } from "./canvas/drawn.js";
import { NOTHING_INSPECTED, drawnEntities, inspectedEqual, inspectedOf, joinsOf } from "./inspect.js";

const T = Schematic.Types;

const ref = (kind: string, key: string): SchematicRef => ({ kind, key });
const A01 = ref("racks", "A01"), A02 = ref("racks", "A02"), ODF = ref("network", "ODF-1"), PDU = ref("pdus", "PDU-A");
const CAGE = ref("areas", "cage-a"), U1 = ref("fibre", "u1"), FEED = ref("feeds", "feed-a");

/** A drawing: two racks, a frame and a power unit; a cage; u1 from A01 to ODF-1; feed-a from PDU-A to A01 and A02. */
const DRAWN: SchematicDrawn = {
    items: [A01, A02, ODF, PDU].map((at, i) => drawnItem(at, { ...defaultValue<typeof T.Item>(T.Item), position: some({ x: i * 3, y: 2 }), label: at.key }, undefined)!),
    zones: [drawnZone(CAGE, { ...defaultValue<typeof T.Zone>(T.Zone), label: "Cage A", width: 20, height: 5 })],
    links: [drawnLink(U1, { ...defaultValue<typeof T.Link>(T.Link), from: A01, to: ODF })],
    nets: [drawnNet(FEED, { ...defaultValue<typeof T.Net>(T.Net), sources: [PDU], destinations: [A01, A02] })],
};
const ENTITIES = drawnEntities(DRAWN);

describe("inspectedOf", () => {
    test("nothing selected shows the drawing; one entity shows it, by its sort", () => {
        expect(inspectedOf(new Set(), null, ENTITIES)).toEqual(NOTHING_INSPECTED);
        expect(inspectedOf(new Set([entityId(A01)]), null, ENTITIES)).toEqual({ view: "entity", sort: "item", id: entityId(A01), ref: A01 });
        expect(inspectedOf(new Set([entityId(CAGE)]), null, ENTITIES)).toEqual({ view: "entity", sort: "zone", id: entityId(CAGE), ref: CAGE });
        expect(inspectedOf(new Set([entityId(U1)]), null, ENTITIES)).toEqual({ view: "entity", sort: "link", id: entityId(U1), ref: U1 });
        expect(inspectedOf(new Set([entityId(FEED)]), null, ENTITIES)).toEqual({ view: "entity", sort: "net", id: entityId(FEED), ref: FEED });
    });

    test("a net with a stub selected shows its leg; a leg beside anything but a net is no leg", () => {
        const leg = { end: "destination" as const, item: entityId(A02) };
        expect(inspectedOf(new Set([entityId(FEED)]), leg, ENTITIES)).toEqual({ view: "leg", id: entityId(FEED), ref: FEED, leg });
        expect(inspectedOf(new Set([entityId(U1)]), leg, ENTITIES)).toEqual({ view: "entity", sort: "link", id: entityId(U1), ref: U1 });
    });

    test("several show in the order the canvas selected them; an id the drawing no longer draws is left out", () => {
        const several = inspectedOf(new Set([entityId(A02), entityId(ref("racks", "gone")), entityId(A01), entityId(U1)]), null, ENTITIES);
        expect(several).toEqual({
            view: "several",
            entities: [{ id: entityId(A02), sort: "item", ref: A02 }, { id: entityId(A01), sort: "item", ref: A01 }, { id: entityId(U1), sort: "link", ref: U1 }],
        });
        // One left of two: that one alone.
        expect(inspectedOf(new Set([entityId(ref("racks", "gone")), entityId(A01)]), null, ENTITIES)).toEqual({ view: "entity", sort: "item", id: entityId(A01), ref: A01 });
        expect(inspectedOf(new Set([entityId(ref("racks", "gone"))]), null, ENTITIES)).toEqual(NOTHING_INSPECTED);
    });
});

describe("inspectedEqual", () => {
    test("one when it shows the same view of the same entities; a leg by its side and its item", () => {
        const a = inspectedOf(new Set([entityId(A01)]), null, ENTITIES);
        expect(inspectedEqual(a, inspectedOf(new Set([entityId(A01)]), null, ENTITIES))).toBe(true);
        expect(inspectedEqual(a, inspectedOf(new Set([entityId(A02)]), null, ENTITIES))).toBe(false);
        expect(inspectedEqual(NOTHING_INSPECTED, inspectedOf(new Set(), null, ENTITIES))).toBe(true);
        const leg = (item: SchematicRef) => inspectedOf(new Set([entityId(FEED)]), { end: "destination", item: entityId(item) }, ENTITIES);
        expect(inspectedEqual(leg(A01), leg(A01))).toBe(true);
        expect(inspectedEqual(leg(A01), leg(A02))).toBe(false);
        expect(inspectedEqual(leg(A01), inspectedOf(new Set([entityId(FEED)]), null, ENTITIES))).toBe(false);
        const both = inspectedOf(new Set([entityId(A01), entityId(A02)]), null, ENTITIES);
        expect(inspectedEqual(both, inspectedOf(new Set([entityId(A01), entityId(A02)]), null, ENTITIES))).toBe(true);
        expect(inspectedEqual(both, inspectedOf(new Set([entityId(A02), entityId(A01)]), null, ENTITIES))).toBe(false);
    });
});

describe("joinsOf", () => {
    test("an item's links from or to it, and the nets it is a member of, each on its side", () => {
        const a01 = joinsOf(entityId(A01), DRAWN);
        expect(a01.links.map((link) => link.key)).toEqual([entityId(U1)]);
        expect(a01.nets.map(({ net, end }) => [net.key, end])).toEqual([[entityId(FEED), "destination"]]);
        expect(joinsOf(entityId(PDU), DRAWN).nets.map(({ end }) => end)).toEqual(["source"]);
        expect(joinsOf(entityId(ODF), DRAWN).links).toHaveLength(1);
        expect(joinsOf(entityId(ODF), DRAWN).nets).toEqual([]);
    });
});
