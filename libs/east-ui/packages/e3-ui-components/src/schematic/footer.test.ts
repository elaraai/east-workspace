/**
 * Copyright (c) 2025 Elara AI Pty Ltd
 * Dual-licensed under AGPL-3.0 and commercial license. See LICENSE for details.
 *
 * What the footer counts of a drawing (#1387, `counts.ts`, §6.3): each item
 * kind's items drawn, the zones, the links between two items drawn and the
 * nets with a member drawn on either side — each sort only where the
 * Schematic has a kind of it, and nothing a hidden layer holds. Fixtures are
 * real East values, made what the canvas draws by `drawn.ts`.
 */

import { describe, test, expect } from "vitest";
import { defaultValue, some } from "@elaraai/east";
import { Schematic } from "@elaraai/e3-ui/internal";
import { drawnItem, drawnLink, drawnNet, drawnZone, entityId, type SchematicRef } from "./canvas/drawn.js";
import { NO_LAYER_STATE } from "./canvas/layers.js";
import { schematicCounts } from "./counts.js";

const item = (ref: SchematicRef) => drawnItem(ref, {
    ...defaultValue<typeof Schematic.Types.Item>(Schematic.Types.Item), position: some({ x: 1, y: 1 }), label: ref.key,
}, undefined)!;

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

describe("schematicCounts", () => {
    test("each item kind's items drawn, in the Schematic's order of its kinds; the zones, the links and the nets drawn", () => {
        expect(schematicCounts(KINDS, DRAWN, NO_LAYER_STATE)).toEqual({
            kinds: [{ slot: "racks", name: "Rack", drawn: 2 }, { slot: "network", name: "Network frame", drawn: 1 },
                { slot: "pdus", name: "Power distribution unit", drawn: 1 }, { slot: "cooling", name: "Cooling unit", drawn: 0 }],
            zones: 1, links: 2, nets: 1,
        });
    });

    test("a sort the Schematic has no kind of is not counted", () => {
        const counts = schematicCounts({ ...KINDS, zones: false, links: false, nets: false }, DRAWN, NO_LAYER_STATE);
        expect([counts.zones, counts.links, counts.nets]).toEqual([undefined, undefined, undefined]);
    });

    test("nothing a hidden layer holds is counted: a link loses an end, a net a side", () => {
        const hidden = { ...NO_LAYER_STATE, hidden: new Set([entityId(A02), entityId(PDU), entityId({ kind: "areas", key: "cage-a" })]) };
        expect(schematicCounts(KINDS, DRAWN, hidden)).toEqual({
            kinds: [{ slot: "racks", name: "Rack", drawn: 1 }, { slot: "network", name: "Network frame", drawn: 1 },
                { slot: "pdus", name: "Power distribution unit", drawn: 0 }, { slot: "cooling", name: "Cooling unit", drawn: 0 }],
            zones: 0, links: 1, nets: 0,
        });
    });
});
