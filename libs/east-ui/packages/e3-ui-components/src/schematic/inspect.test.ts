/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * @vitest-environment jsdom
 *
 * What the Schematic's inspector shows (#1391, `inspect.ts`), pure: the
 * selection as Details shows it — the drawing, one entity, a net's leg, or
 * several in the order the canvas selected them, an id the drawing no longer
 * draws left out — whether two of them are one, what an item is joined to, and
 * each entity's one name, never a key the Schematic minted. Fixtures are real
 * East values typed from the Schematic's East types.
 */

import { describe, expect, test } from "vitest";
import { defaultValue, some } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { formatters } from "@elaraai/east-ui-components";
import { drawnItem, drawnLink, drawnNet, drawnZone, entityId, type SchematicDrawn, type SchematicRef } from "./canvas/drawn.js";
import { NOTHING_INSPECTED, drawnEntities, entityNames, inspectedEqual, inspectedOf, joinsOf, nameOfEntity } from "./inspect.js";
import { schematicMessages, type SchematicWords } from "./messages.js";

/** The Schematic's words, in English. */
const words: SchematicWords = { ...formatters("en-US"), m: schematicMessages };

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

describe("entityNames", () => {
    test("an item and a zone by their labels; a link by its ends' items; a net by its label — never a key", () => {
        const labelled = { ...DRAWN, nets: [drawnNet(FEED, { ...defaultValue<typeof T.Net>(T.Net), label: some("PDU-A · A side"), sources: [PDU], destinations: [A01, A02] })] };
        const names = entityNames(labelled, words);
        expect([entityId(A01), entityId(CAGE), entityId(U1), entityId(FEED)].map((id) => names.get(id))).toEqual(["A01", "Cage A", "A01 → ODF-1", "PDU-A · A side"]);
    });

    test("a link or a net the Schematic minted a key for is named by what it joins: a net with no label by its sources, then its destinations, three a side and how many more", () => {
        const minted = (kind: string) => ref(kind, "5f0c1d6e-3a7b-4c2d-9e8f-0a1b2c3d4e5f");
        const racks = Array.from({ length: 5 }, (_, i) => ref("racks", `B0${i + 1}`));
        const drawn: SchematicDrawn = {
            items: [...DRAWN.items, ...racks.map((at, i) => drawnItem(at, { ...defaultValue<typeof T.Item>(T.Item), position: some({ x: i, y: 6 }), label: at.key }, undefined)!)],
            zones: [],
            links: [drawnLink(minted("fibre"), { ...defaultValue<typeof T.Link>(T.Link), from: A02, to: ODF })],
            nets: [
                drawnNet(minted("trunks"), { ...defaultValue<typeof T.Net>(T.Net), sources: [A01], destinations: [ODF, PDU] }),
                drawnNet(ref("trunks", "many"), { ...defaultValue<typeof T.Net>(T.Net), sources: racks, destinations: [ODF] }),
            ],
        };
        const names = entityNames(drawn, words);
        expect(names.get(entityId(minted("fibre")))).toBe("A02 → ODF-1");
        expect(names.get(entityId(minted("trunks")))).toBe("A01 → ODF-1, PDU-A");
        expect(names.get(entityId(ref("trunks", "many")))).toBe("B01, B02, B03 and 2 more → ODF-1");
    });

    test("an end the drawing doesn't draw is named by its key; an entity it doesn't draw, by the key its id names", () => {
        const stray = drawnLink(ref("fibre", "u9"), { ...defaultValue<typeof T.Link>(T.Link), from: A01, to: ref("network", "ODF-9") });
        const names = entityNames({ ...DRAWN, links: [stray] }, words);
        expect(names.get(entityId(ref("fibre", "u9")))).toBe("A01 → ODF-9");
        expect(nameOfEntity(names, entityId(ref("racks", "gone")))).toBe("gone");
        expect(nameOfEntity(names, entityId(A02))).toBe("A02");
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
