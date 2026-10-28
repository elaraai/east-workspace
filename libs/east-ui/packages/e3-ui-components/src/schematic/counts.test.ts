/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What the drawing's Details counts of a drawing (#1387, #1391, `counts.ts`,
 * §9): each item kind's items drawn, the zones, the links between two items
 * drawn and the nets with a member drawn on either side — each sort only where
 * the Schematic has a kind of it, and nothing a hidden layer holds. Fixtures
 * are real East values, made what the canvas draws by `drawn.ts`.
 */

import { describe, test, expect } from "vitest";
import { StringType, defaultValue, equalFor, none, some } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { drawnItem, drawnLink, drawnNet, drawnZone, entityId, type SchematicRef } from "./canvas/drawn.js";
import { NO_LAYER_STATE } from "./canvas/layers.js";
import { COUNT_READING, counted, draftedAreaCounts, schematicCounts, uncounted } from "./counts.js";

const item = (ref: SchematicRef) => drawnItem(ref, {
    ...defaultValue<typeof Schematic.Types.Item>(Schematic.Types.Item), position: some({ x: 1, y: 1 }), label: ref.key,
}, undefined)!;

const stringEqual = equalFor(StringType);

const A01 = { kind: "racks", key: "A01" };
const A02 = { kind: "racks", key: "A02" };
const ODF = { kind: "network", key: "ODF-1" };
const PDU = { kind: "pdus", key: "PDU-A" };

const DRAWN = {
    items: [item(A01), item(A02), item(ODF), item(PDU)],
    zones: [drawnZone({ kind: "areas", key: "cage-a" }, defaultValue<typeof Schematic.Types.Zone>(Schematic.Types.Zone))],
    links: [
        drawnLink({ kind: "fibre", key: "u1" }, { ...defaultValue<typeof Schematic.Types.Link>(Schematic.Types.Link), from: A01, to: ODF }),
        drawnLink({ kind: "fibre", key: "u2" }, { ...defaultValue<typeof Schematic.Types.Link>(Schematic.Types.Link), from: A02, to: ODF }),
    ],
    nets: [drawnNet({ kind: "feeds", key: "f1" }, { ...defaultValue<typeof Schematic.Types.Net>(Schematic.Types.Net), sources: [PDU], destinations: [A01, A02] })],
};

const KINDS = {
    items: [{ key: "racks", name: "Rack" }, { key: "network", name: "Network frame" }, { key: "pdus", name: "Power distribution unit" }, { key: "cooling", name: "Cooling unit" }],
    zones: true, links: true, nets: true,
};

describe("draftedAreaCounts", () => {
    /** A rack's roles, placed or not. */
    const rack = (key: string, placed: boolean) => ({
        ...defaultValue<typeof Schematic.Types.Item>(Schematic.Types.Item), position: placed ? some({ x: 1, y: 1 }) : none, label: key,
    });
    const RACKS = [{ key: "racks", sort: "items" as const }];

    test("a kind's stored count, each row its drafts hold one more or one fewer as its draft and the row it began from have a position", () => {
        const drafts = {
            items: new Map([["racks", new Map([
                // Unplaced by its draft: one fewer. Placed from the Backlog: one more. Moved: as it was. Made, placed: one more.
                ["A01", { roles: rack("A01", false), created: false, began: rack("A01", true) }],
                ["A06", { roles: rack("A06", true), created: false, began: rack("A06", false) }],
                ["A02", { roles: rack("A02", true), created: false, began: rack("A02", true) }],
                ["new-1", { roles: rack("new-1", true), created: true }],
                // Deleted, placed when its session began: one fewer.
                ["A03", undefined],
            ])]]),
            zones: new Map(),
        };
        const began = (ref: SchematicRef) => (stringEqual(ref.key, "A03") ? true : undefined);
        // 5 stored: A01 −1, A06 +1, A02 ±0, new-1 +1, A03 −1.
        expect(draftedAreaCounts(RACKS, new Map([["racks", counted(5)]]), drafts, () => undefined, began, false)).toEqual(new Map([["racks", counted(5)]]));
        // A row the narrowing leaves out — by the row it began from — moves no count: A01's unplacing counts nothing.
        const heldBut = (ref: SchematicRef) => !stringEqual(ref.key, "A01");
        expect(draftedAreaCounts(RACKS, new Map([["racks", counted(5)]]), drafts, heldBut, began, false)).toEqual(new Map([["racks", counted(6)]]));
    });

    test("a count in flight stays so, and while a layer is hidden no read can say a kind's count", () => {
        const nothing = { items: new Map(), zones: new Map() };
        expect(draftedAreaCounts(RACKS, new Map(), nothing, () => undefined, () => undefined, false)).toEqual(new Map([["racks", COUNT_READING]]));
        expect(draftedAreaCounts(RACKS, new Map([["racks", counted(5)]]), nothing, () => undefined, () => undefined, true)).toEqual(new Map([["racks", uncounted("layer")]]));
    });
});

describe("schematicCounts", () => {
    test("each item kind's items drawn, in the Schematic's order of its kinds; the zones, the links and the nets drawn", () => {
        expect(schematicCounts(KINDS, DRAWN, NO_LAYER_STATE)).toEqual({
            kinds: [{ slot: "racks", name: "Rack", drawn: counted(2) }, { slot: "network", name: "Network frame", drawn: counted(1) },
                { slot: "pdus", name: "Power distribution unit", drawn: counted(1) }, { slot: "cooling", name: "Cooling unit", drawn: counted(0) }],
            zones: counted(1), links: counted(2), nets: counted(1),
        });
    });

    test("a sort the Schematic has no kind of is not counted", () => {
        const counts = schematicCounts({ ...KINDS, zones: false, links: false, nets: false }, DRAWN, NO_LAYER_STATE);
        expect([counts.zones, counts.links, counts.nets]).toEqual([undefined, undefined, undefined]);
    });

    test("nothing a hidden layer holds is counted: a link loses an end, a net a side", () => {
        const hidden = { ...NO_LAYER_STATE, hidden: new Set([entityId(A02), entityId(PDU), entityId({ kind: "areas", key: "cage-a" })]) };
        expect(schematicCounts(KINDS, DRAWN, hidden)).toEqual({
            kinds: [{ slot: "racks", name: "Rack", drawn: counted(1) }, { slot: "network", name: "Network frame", drawn: counted(1) },
                { slot: "pdus", name: "Power distribution unit", drawn: counted(0) }, { slot: "cooling", name: "Cooling unit", drawn: counted(0) }],
            zones: counted(0), links: counted(1), nets: counted(0),
        });
    });

    test("a kind read by area is counted as given, never by what its window draws — in flight until it is — and a link or a net that may join one is not counted", () => {
        // The racks read by area: their window draws two, the count given says 5; the areas too, their count in flight.
        const byArea = { ...KINDS, areas: new Set(["racks", "areas"]), linksByArea: true, netsByArea: true };
        const counts = schematicCounts(byArea, DRAWN, NO_LAYER_STATE, new Map([["racks", counted(5)]]));
        expect([counts.kinds[0]!.drawn, counts.kinds[1]!.drawn, counts.zones, counts.links, counts.nets])
            .toEqual([counted(5), counted(1), COUNT_READING, uncounted("ends"), uncounted("ends")]);
        // A kind no read can count: the zones' sum says why.
        const layered = schematicCounts(byArea, DRAWN, NO_LAYER_STATE, new Map([["racks", uncounted("layer")], ["areas", uncounted("layer")]]));
        expect([layered.kinds[0]!.drawn, layered.zones]).toEqual([uncounted("layer"), uncounted("layer")]);
    });
});
